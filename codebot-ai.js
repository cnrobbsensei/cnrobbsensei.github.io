/* ==========================================================================
   Code Ninjas – Robbinsville : codebot-ai.js
   CodeBot's local AI — real models that run inside the browser, no server
   and no API keys. Loaded on every page right after codebot.js.

   1. Moderation model (Transformers.js + Xenova/toxic-bert, ~110 MB, runs on
      the CPU via WebAssembly so it works on ordinary computers). Catches
      bullying/insults/threats that contain no "bad words". Auto-loads on the
      Chat, Polls and Kiosk pages (and on Sensei pages when AI is on), and is
      cached by the browser after the first download.
   2. Sensei brain (WebLLM + Qwen2.5-1.5B-Instruct, ~1 GB, needs WebGPU).
      Only ever loaded on a Sensei's computer, and only after they turn it on.
      It understands free-form questions (turning them into CodeBot's exact
      commands) and writes new riddles. It never changes data by itself —
      every action still goes through CodeBot's rule engine and its
      confirmations.

   Everything degrades gracefully: if a model can't load, CodeBot keeps
   working on its built-in rules.
   ========================================================================== */
(function(){
  if(!window.cnDb) return;
  const db = window.cnDb;

  // Pinned library versions (CDN) and models.
  const TJS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js";
  const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.87/+esm";
  const MOD_MODEL = "Xenova/toxic-bert";
  const LLM_MODELS = {
    standard: {f16:"Qwen2.5-1.5B-Instruct-q4f16_1-MLC", f32:"Qwen2.5-1.5B-Instruct-q4f32_1-MLC", label:"Qwen2.5 1.5B"},
    small:    {f16:"Qwen2.5-0.5B-Instruct-q4f16_1-MLC", f32:"Qwen2.5-0.5B-Instruct-q4f32_1-MLC", label:"Qwen2.5 0.5B"},
  };
  const LS_LLM = "cn_codebot_ai_llm";        // "standard" | "small" | "" — auto-load on this computer
  const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k,v){ try{ if(v) localStorage.setItem(k,v); else localStorage.removeItem(k); }catch(e){} }
  function isAdmin(){ const s = window.cnSession && window.cnSession.getSession(); return !!(s && s.role === "admin"); }

  const listeners = new Set();
  function emit(){ listeners.forEach(fn => { try{ fn(api.status()); }catch(e){} }); }

  // -------------------------------------------------------------------------
  // 1. Moderation model
  // -------------------------------------------------------------------------
  const mod = {state:"off", progress:0, error:null, clf:null, promise:null};
  let aiModerationEnabled = true; // Sensei switch, stored at codebot/settings/aiModeration

  function loadModeration(){
    if(mod.promise) return mod.promise;
    mod.state = "loading"; mod.progress = 0; emit();
    mod.promise = (async () => {
      const T = await import(window.CN_TJS_URL || TJS_URL);
      const files = {};
      mod.clf = await T.pipeline("text-classification", MOD_MODEL, {
        dtype:"q8", device:"wasm",
        progress_callback: p => {
          if(p && p.status === "progress" && p.file && p.total){
            files[p.file] = {loaded:p.loaded||0, total:p.total};
            const all = Object.values(files);
            mod.progress = Math.round(100 * all.reduce((a,f)=>a+f.loaded,0) / Math.max(1, all.reduce((a,f)=>a+f.total,0)));
            emit();
          }
        }
      });
      mod.state = "ready"; mod.progress = 100; emit();
      return true;
    })().catch(e => {
      console.warn("CodeBot moderation model failed to load:", e);
      mod.state = "error"; mod.error = String(e && e.message || e); mod.promise = null; emit();
      return false;
    });
    return mod.promise;
  }

  // Thresholds calibrated on sample dojo chat: gaming talk ("I'm going to kill
  // this boss level", "attack the zombies!") scores high on toxic/threat but
  // isn't aimed at a person, so threats/general toxicity only block when the
  // message is directed at someone.
  const TARGETS_PERSON = /\b(you|u|ur|your|youre|yours|yourself|ya|people like)\b/i;
  // opts.strict (used for polls, which only get HELD for a Sensei, never
  // deleted): lower thresholds, because "rank your classmates" polls score
  // milder than direct insults (e.g. "most worthless person here?" = toxic .67).
  async function classify(text, opts){
    if(mod.state !== "ready" || !aiModerationEnabled) return null;
    const strict = !!(opts && opts.strict);
    const t = String(text||"").trim();
    if(!t) return {ok:true};
    const out = await mod.clf(t.slice(0, 500), {top_k:null});
    const s = {}; for(const o of out) s[o.label] = o.score;
    const aimed = TARGETS_PERSON.test(t.replace(/['’]/g,""));
    let category = null;
    if(strict){
      if((s.identity_hate||0) >= 0.3) category = "slur";
      else if((s.insult||0) >= 0.25 || (s.toxic||0) >= 0.6 || (s.threat||0) >= 0.4 || (s.severe_toxic||0) >= 0.3) category = "unkind";
    }
    else if((s.identity_hate||0) >= 0.5) category = "slur";
    else if((s.severe_toxic||0) >= 0.5 || (s.insult||0) >= 0.5) category = "unkind";
    else if(aimed && (s.threat||0) >= 0.6) category = "unkind";
    else if((s.toxic||0) >= 0.9 || (aimed && (s.toxic||0) >= 0.7)) category = "unkind";
    if(!category) return {ok:true, scores:s};
    const reasons = {
      slur:"That could be hurtful to a group of people — that's never okay here.",
      unkind:"That sounds unkind, insulting, or threatening. Let's keep the dojo friendly.",
    };
    return {ok:false, category, reason:reasons[category], scores:s, ai:true};
  }

  // -------------------------------------------------------------------------
  // 2. Sensei brain (LLM)
  // -------------------------------------------------------------------------
  const llm = {state:"off", progress:0, text:"", error:null, engine:null, promise:null, size:null, modelId:null};

  async function webgpuInfo(){
    if(!navigator.gpu) return {ok:false, why:"This browser doesn't support WebGPU (try a recent Chrome or Edge)."};
    try{
      const adapter = await navigator.gpu.requestAdapter();
      if(!adapter) return {ok:false, why:"No compatible graphics adapter was found on this computer."};
      return {ok:true, f16: adapter.features.has("shader-f16")};
    }catch(e){ return {ok:false, why:"WebGPU couldn't start: " + (e && e.message || e)}; }
  }

  async function loadLLM(size){
    size = LLM_MODELS[size] ? size : "standard";
    if(llm.promise && llm.size === size) return llm.promise;
    if(llm.engine){ try{ await llm.engine.unload(); }catch(e){} llm.engine = null; }
    llm.size = size; llm.state = "loading"; llm.progress = 0; llm.text = "Checking this computer…"; llm.error = null; emit();
    llm.promise = (async () => {
      const gpu = await webgpuInfo();
      if(!gpu.ok) throw new Error(gpu.why);
      const W = await import(window.CN_WEBLLM_URL || WEBLLM_URL);
      llm.modelId = gpu.f16 ? LLM_MODELS[size].f16 : LLM_MODELS[size].f32;
      llm.engine = await W.CreateMLCEngine(llm.modelId, {
        initProgressCallback: r => {
          llm.progress = Math.round((r.progress || 0) * 100);
          llm.text = r.text || "";
          emit();
        }
      });
      llm.state = "ready"; llm.progress = 100; llm.text = ""; emit();
      return true;
    })().catch(e => {
      console.warn("CodeBot AI brain failed to load:", e);
      llm.state = "error"; llm.error = String(e && e.message || e); llm.promise = null; llm.engine = null; emit();
      return false;
    });
    return llm.promise;
  }

  async function unloadLLM(){
    if(llm.engine){ try{ await llm.engine.unload(); }catch(e){} }
    llm.engine = null; llm.promise = null; llm.state = "off"; llm.progress = 0; emit();
  }

  let llmQueue = Promise.resolve(); // one generation at a time
  function chatJSON(messages, schema, opts){
    opts = opts || {};
    const run = async () => {
      if(llm.state !== "ready") throw new Error("AI brain isn't loaded.");
      const res = await llm.engine.chat.completions.create({
        messages, temperature: opts.temperature ?? 0.2, max_tokens: opts.max_tokens || 300,
        response_format: {type:"json_object", schema: JSON.stringify(schema)}
      });
      const raw = (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || "";
      try{ return JSON.parse(raw); }
      catch(e){ const m = raw.match(/\{[\s\S]*\}/); if(m) return JSON.parse(m[0]); throw new Error("AI reply wasn't valid JSON."); }
    };
    const p = llmQueue.then(run, run);
    llmQueue = p.catch(()=>{});
    return p;
  }

  // Free text -> one exact CodeBot command (or a short answer from context).
  const COMMANDS = [
    "status", "audit", "audit week", "leaderboard", "leaderboard week N", "who's here",
    "stats NAME", "add POINTS to NAME", "add POINTS to NAME for 1 hour", "undo", "remove last entry for NAME",
    "rename OLDNAME to NEWNAME", "riddle", "riddle week N", "submissions", "new riddle", "answer is ANSWER",
    "answer for week N is ANSWER", "results", "results week N", "grade now", "riddles left", "riddle queue",
    "moderation", "polls", "check: TEXT", "ban NAME", "unban NAME", "help"
  ];
  const INTENT_SCHEMA = {type:"object", properties:{
    action:{type:"string", enum:["command","answer"]},
    command:{type:"string"}, answer:{type:"string"}}, required:["action"]};

  async function interpret(text, context){
    const sys = [
      "You are CodeBot, the assistant for Senseis (teachers) at a Code Ninjas kids coding dojo.",
      "Turn the Sensei's message into exactly ONE command from this list, filling in NAME/POINTS/N/ANSWER/TEXT from the message:",
      COMMANDS.map(c => "- " + c).join("\n"),
      "Reply as JSON: {\"action\":\"command\",\"command\":\"<the command>\"}.",
      "Only if no command fits, reply {\"action\":\"answer\",\"answer\":\"<short helpful answer>\"} using ONLY the dojo facts below; never invent names or numbers.",
      "Dojo facts right now:\n" + context
    ].join("\n");
    return chatJSON([{role:"system", content:sys}, {role:"user", content:text}], INTENT_SCHEMA, {temperature:0.1, max_tokens:200});
  }

  // Riddle writer. CodeBot validates everything it returns.
  const RIDDLE_SCHEMA = {type:"object", properties:{
    question:{type:"string"}, answer:{type:"string"}, alternates:{type:"array", items:{type:"string"}}},
    required:["question","answer"]};
  const THEMES = ["animals","space","coding and computers","video games","food","nature","the ocean","sports","weather","household objects",
    "robots","music","school supplies","dinosaurs","holidays","the human body","maps and travel","time and clocks","numbers","letters and words"];
  async function writeRiddle(avoidAnswers){
    const theme = THEMES[Math.floor(Math.random()*THEMES.length)];
    const sys = "You write fun, clean riddles for kids aged 7-14 at a coding school. Each riddle is 1-3 sentences, ends with a question mark, " +
      "has ONE clear answer of 1-2 words that is NOT written anywhere in the riddle, and is solvable by thinking (wordplay or clues). " +
      "Reply as JSON {\"question\":\"...\",\"answer\":\"...\",\"alternates\":[\"other accepted answers\"]}.";
    const user = `Write a brand-new riddle about ${theme}.` + (avoidAnswers && avoidAnswers.length ? ` Its answer must NOT be any of: ${avoidAnswers.slice(-60).join(", ")}.` : "");
    return chatJSON([{role:"system", content:sys}, {role:"user", content:user}], RIDDLE_SCHEMA, {temperature:0.9, max_tokens:220});
  }

  // -------------------------------------------------------------------------
  // Settings, auto-load, public API
  // -------------------------------------------------------------------------
  db.ref("codebot/settings/aiModeration").on("value", snap => {
    aiModerationEnabled = snap.val() !== false;
    emit();
  });

  const api = {
    // moderation
    loadModeration, classify,
    moderationReady: () => mod.state === "ready" && aiModerationEnabled,
    setModerationEnabled: on => db.ref("codebot/settings/aiModeration").set(!!on),
    // llm
    loadLLM, unloadLLM, interpret, writeRiddle,
    llmReady: () => llm.state === "ready",
    autoLLM: () => lsGet(LS_LLM) || "",
    setAutoLLM: size => lsSet(LS_LLM, size || ""),
    webgpuInfo,
    modelLabel: () => llm.size ? LLM_MODELS[llm.size].label : LLM_MODELS.standard.label,
    status(){
      return {
        moderation:{state:mod.state, progress:mod.progress, error:mod.error, enabled:aiModerationEnabled},
        llm:{state:llm.state, progress:llm.progress, text:llm.text, error:llm.error, size:llm.size, modelId:llm.modelId},
      };
    },
    onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); },
  };
  window.cnCodeBotAI = api;
  if(window.cnCodeBot && window.cnCodeBot._attachAI) window.cnCodeBot._attachAI(api);

  function boot(){
    // The moderation model runs where content is created or watched.
    const modPages = ["chat.html","polls.html","kiosk.html"];
    if(modPages.includes(page) || (isAdmin() && lsGet(LS_LLM))){
      // Skip the download entirely when a Sensei has switched AI moderation off.
      db.ref("codebot/settings/aiModeration").once("value")
        .then(snap => { if(snap.val() !== false) setTimeout(loadModeration, 800); })
        .catch(() => setTimeout(loadModeration, 800));
    }
    // The Sensei brain only auto-loads on a Sensei computer that opted in.
    if(isAdmin() && lsGet(LS_LLM)) setTimeout(() => loadLLM(lsGet(LS_LLM)), 1500);
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
