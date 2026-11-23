/* ==========================================================================
   Code Ninjas – Robbinsville : codebot.js
   CodeBot — a fully in-browser ("local") assistant. No external AI service,
   no API keys: everything runs on the site itself against Firebase.

   Two halves:
   1. Weekly engine (runs on EVERY page load, for every role, incl. kiosk):
      - Makes sure the current week has a riddle, picking a never-used one
        from the bank below (falling back to generated riddles once the bank
        runs out). The answer is kept in codebot/answers/week_N, not in the
        riddle node the Riddle tab downloads.
      - Once a week is over, grades every submission, locks in the first
        correct ninja as winner (or "no one"), reveals the answer, and
        announces the result in Ninja Chat.
      All writes go through Firebase transactions so several open tabs
      can't double-set a riddle or double-announce.
   2. Admin chat widget (only rendered for role === "admin"): a floating
      🤖 button where Senseis can ask questions / give commands — points,
      audits, stats, riddle management. Type "help" in it for the list.

   Load order: after shared.js (needs window.cnDb, fbLeaderboard, etc).
   ========================================================================== */
(function(){
  if(!window.cnDb || !window.fbLeaderboard) return;
  const db = window.cnDb;
  const MAX_ATTEMPTS = window.CN_MAX_ATTEMPTS_PER_DAY || 3;
  const CHAT_RECENT_WEEKS = 1;   // only announce in chat for last week's result
  const NEEDS_ANSWER_LOOKBACK = 4; // nag admins about weeks this recent only

  // -------------------------------------------------------------------------
  // Riddle bank. ids must be Firebase-key safe (letters, digits, _).
  // -------------------------------------------------------------------------
  const RIDDLES = [
    {id:"echo",q:"I speak without a mouth and hear without ears. I have no body, but I come alive with the wind. What am I?",a:"echo"},
    {id:"keyboard",q:"I have keys but open no locks. I have space but no room. You can enter, but you can't go outside. What am I?",a:"keyboard"},
    {id:"footsteps",q:"The more you take, the more you leave behind. What am I?",a:"footsteps",alts:["steps","footprints"]},
    {id:"towel",q:"What gets wetter the more it dries?",a:"towel"},
    {id:"candle",q:"I'm tall when I'm young and short when I'm old. What am I?",a:"candle"},
    {id:"map",q:"I have cities, but no houses. I have mountains, but no trees. I have water, but no fish. What am I?",a:"map"},
    {id:"egg",q:"What has to be broken before you can use it?",a:"egg"},
    {id:"future",q:"What is always in front of you but can't be seen?",a:"future"},
    {id:"silence",q:"What can you break, even if you never pick it up or touch it?",a:"promise",alts:["silence","a promise"]},
    {id:"hole",q:"The more you take away from me, the bigger I get. What am I?",a:"hole"},
    {id:"sponge",q:"I'm full of holes but I can still hold water. What am I?",a:"sponge"},
    {id:"name",q:"What belongs to you, but other people use it more than you do?",a:"name",alts:["your name"]},
    {id:"letter_m",q:"What comes once in a minute, twice in a moment, but never in a thousand years?",a:"m",alts:["letter m","the letter m"]},
    {id:"piano",q:"What has many keys but can't open a single door?",a:"piano"},
    {id:"stamp",q:"What can travel all around the world while staying in a corner?",a:"stamp"},
    {id:"needle",q:"What has one eye but can't see?",a:"needle"},
    {id:"clock",q:"What has hands and a face but can't hold anything or smile?",a:"clock",alts:["watch"]},
    {id:"river",q:"What runs all around but never walks, has a mouth but never talks, has a bed but never sleeps?",a:"river"},
    {id:"shadow",q:"I follow you all day long, but when the sun goes down I'm gone. What am I?",a:"shadow"},
    {id:"bottle",q:"What has a neck but no head?",a:"bottle"},
    {id:"comb",q:"I have teeth but I can't bite. What am I?",a:"comb",alts:["zipper","saw"]},
    {id:"coin",q:"What has a head and a tail but no body?",a:"coin"},
    {id:"age",q:"What goes up but never comes down?",a:"age",alts:["your age"]},
    {id:"secret",q:"If you have me, you want to share me. If you share me, you don't have me anymore. What am I?",a:"secret"},
    {id:"envelope",q:"What starts with E, ends with E, and usually has only one letter in it?",a:"envelope"},
    {id:"pencil",q:"I'm taken from a mine and shut in a wooden case, from which I'm never released, yet I'm used by almost everyone. What am I?",a:"pencil lead",alts:["pencil","graphite","lead"]},
    {id:"tomorrow",q:"What is always coming but never arrives?",a:"tomorrow"},
    {id:"glove",q:"What has four fingers and a thumb but isn't alive?",a:"glove"},
    {id:"stairs",q:"What goes up and down but never moves?",a:"stairs",alts:["staircase","steps"]},
    {id:"ice",q:"I'm water, but if you put me in water I float. What am I?",a:"ice",alts:["ice cube"]},
    {id:"fire",q:"Feed me and I live, give me a drink and I die. What am I?",a:"fire"},
    {id:"cold",q:"What can you catch but not throw?",a:"cold",alts:["a cold"]},
    {id:"bank",q:"What kind of band never plays music?",a:"rubber band",alts:["rubberband"]},
    {id:"wordshort",q:"What 5-letter word becomes shorter when you add two letters to it?",a:"short"},
    {id:"window",q:"What can you see through, but can't walk through (unless it's open)?",a:"window"},
    {id:"bed",q:"What has four legs in the morning, four legs at noon, and four legs at night — but never walks?",a:"bed",alts:["table","chair"]},
    {id:"bat",q:"What can fly without wings and see without eyes in the dark? (Hint: it's not magic, it's sound.)",a:"bat"},
    {id:"thunder",q:"You can hear me but never see me, and I only show up after lightning does. What am I?",a:"thunder"},
    {id:"wheel",q:"I go round and round and carry people everywhere, but I never get tired. What am I?",a:"wheel",alts:["tire","tyre"]},
    {id:"rainbow",q:"I show up after the rain, I have seven colors, but you can never touch me. What am I?",a:"rainbow"},
    {id:"moon",q:"I change my shape every night but I'm always the same. What am I?",a:"moon"},
    {id:"queue",q:"What word is pronounced the same if you take away four of its five letters?",a:"queue"},
    {id:"sun",q:"I rise every morning without an alarm clock. What am I?",a:"sun"},
    {id:"joke",q:"What can you tell, crack, make, and play?",a:"joke"},
    {id:"teapot",q:"What starts with T, ends with T, and has T in it?",a:"teapot"},
    {id:"bug",q:"Coders hunt me, but I'm not an animal. I make programs crash and act weird. What am I?",a:"bug",alts:["glitch","error"]},
    {id:"loop",q:"I make your code do the same thing over and over until a condition says stop. What am I?",a:"loop",alts:["for loop","while loop"]},
    {id:"variable",q:"I'm a box in your code with a name on it. You can put a value in me and change it later. What am I?",a:"variable"},
    {id:"mouse",q:"I have a tail and I like to click, but I've never eaten a piece of cheese. What am I?",a:"mouse",alts:["computer mouse"]},
    {id:"password",q:"I'm a secret you type but should never say out loud. I keep your accounts safe. What am I?",a:"password"},
    {id:"wifi",q:"You can't see me or touch me, but if I disappear, everyone in the room complains. What am I?",a:"wifi",alts:["wi fi","internet"]},
    {id:"binary",q:"I only know two digits, but computers use me to say everything. What am I?",a:"binary",alts:["binary code"]},
    {id:"cloud",q:"I'm in the sky, but I also store your files. What am I?",a:"cloud"},
    {id:"web",q:"A spider makes me, and so do websites. What am I?",a:"web"},
    {id:"robot",q:"I follow every instruction exactly, even the wrong ones. I'm made of metal and wires. What am I?",a:"robot"},
    {id:"pixel",q:"I'm a tiny square of color. Put millions of me together and you get a picture on a screen. What am I?",a:"pixel"},
    {id:"battery",q:"When I'm full I'm useful, when I'm empty you plug me in. What am I?",a:"battery"},
    {id:"chess",q:"I have kings and queens but no kingdom. I have knights but no swords. What am I?",a:"chess",alts:["chessboard","deck of cards","cards"]},
    {id:"book",q:"I have a spine but no bones, and lots of pages but no web. What am I?",a:"book"},
    {id:"time",q:"What flies when you're having fun but never had wings?",a:"time"},
    {id:"snowman",q:"I have a carrot nose and coal eyes, and I'm gone by spring. What am I?",a:"snowman"},
    {id:"dictionary",q:"Where does Thursday come before Wednesday?",a:"dictionary"},
    {id:"breath",q:"I'm lighter than a feather, yet even the strongest person can't hold me for more than a few minutes. What am I?",a:"breath"},
    {id:"darkness",q:"The more of me there is, the less you see. What am I?",a:"darkness",alts:["dark","fog"]},
    {id:"nothing",q:"Poor people have me, rich people need me, and if you eat me you'll starve. What am I?",a:"nothing"},
    {id:"corn",q:"I'm yellow, I have ears, and I grow in a field, but I can't hear a thing. What am I?",a:"corn"},
    {id:"mirror",q:"I copy everything you do, but I never move first. What am I?",a:"mirror",alts:["reflection"]},
    {id:"lightbulb",q:"I'm the symbol for a great idea, and I light up a room. What am I?",a:"light bulb",alts:["lightbulb","bulb"]},
    {id:"trash",q:"On a computer, you drag things to me to get rid of them. What am I?",a:"trash",alts:["recycle bin","trash can","bin"]},
    {id:"remote",q:"I control your TV from across the room and I always go missing in the couch. What am I?",a:"remote",alts:["remote control"]},
    {id:"seven",q:"Why was six afraid of seven? (Answer with the number that did it.)",a:"789",alts:["seven eight nine","because seven ate nine","7 8 9"]},
    {id:"wordwrong",q:"Which word in the dictionary is always spelled incorrectly?",a:"incorrectly"},
    {id:"fence",q:"What runs around a whole yard without moving?",a:"fence"},
    {id:"carpet",q:"I'm walked on all day, I lie on the floor, and I'm sometimes rolled out for very important people. What am I?",a:"carpet",alts:["rug","red carpet"]},
    {id:"umbrella",q:"I go up when the rain comes down. What am I?",a:"umbrella"},
  ];

  // Generated riddles — used only after every bank riddle has been used, so
  // CodeBot can always produce something new. Ids encode the parameters.
  function randInt(a,b){ return a + Math.floor(Math.random()*(b-a+1)); }
  function generateRiddle(){
    if(Math.random() < 0.5){
      // "What does this code print?"
      const a = randInt(2,9), b = randInt(2,6), c = randInt(1,9);
      const ops = [
        {code:`x = x * ${b} + ${c}`, f:x=>x*b+c, tag:"mul"},
        {code:`x = (x + ${c}) * ${b}`, f:x=>(x+c)*b, tag:"add"},
        {code:`x = x * x - ${c}`, f:x=>x*x-c, tag:"sq"},
      ];
      const op = ops[randInt(0,ops.length-1)];
      const ans = op.f(a);
      return {id:`gen_code_${op.tag}_${a}_${b}_${c}`,
        q:`Code riddle! What number does this program print?  let x = ${a};  ${op.code};  print(x)`,
        a:String(ans), generated:true};
    }
    // Two-digit number riddle with a unique answer.
    const tens = randInt(2,9), ones = randInt(0,9);
    if(tens === ones) return generateRiddle();
    const sum = tens + ones, diff = tens - ones;
    const diffText = diff > 0 ? `my tens digit is ${diff} bigger than my ones digit` : `my ones digit is ${-diff} bigger than my tens digit`;
    return {id:`gen_num_${tens}${ones}`,
      q:`I'm a two-digit number. My digits add up to ${sum}, and ${diffText}. What number am I?`,
      a:String(tens*10+ones), generated:true};
  }

  function normText(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]/g,""); }
  function tokens(s){
    return String(s||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/)
      .filter(w => w && w !== "a" && w !== "an" && w !== "the");
  }
  function wordEq(a,b){ return a===b || a+"s"===b || a+"es"===b || b+"s"===a || b+"es"===a; }
  function containsPhrase(subTok, ansTok){
    if(!ansTok.length) return false;
    for(let i=0;i+ansTok.length<=subTok.length;i++){
      let ok = true;
      for(let j=0;j<ansTok.length;j++){ if(!wordEq(subTok[i+j], ansTok[j])){ ok=false; break; } }
      if(ok) return true;
    }
    return false;
  }
  // Whole-word match (ignoring a/an/the, punctuation, simple plurals) against
  // the official answer or any accepted alternate.
  function answerMatches(submitted, official, alts){
    const sub = tokens(submitted);
    if(!sub.length) return false;
    return [official].concat(alts||[]).some(ans => containsPhrase(sub, tokens(ans)));
  }

  function editDistance(a,b){
    a=String(a); b=String(b);
    const dp = Array.from({length:a.length+1},(_,i)=>[i].concat(Array(b.length).fill(0)));
    for(let j=1;j<=b.length;j++) dp[0][j]=j;
    for(let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++)
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
    return dp[a.length][b.length];
  }
  function firstNameOf(u){ return String(u||"").split(".")[0].trim().toLowerCase(); }

  // -------------------------------------------------------------------------
  // Riddle engine
  // -------------------------------------------------------------------------
  // AI-written riddles (made on a Sensei computer with the AI brain on) wait
  // in codebot/riddleQueue and are used before the built-in bank.
  async function usedRiddleInfo(){
    const [usedSnap, ridSnap, queueSnap, ansSnap] = await Promise.all([
      db.ref("codebot/usedRiddles").once("value"), db.ref("riddles").once("value"),
      db.ref("codebot/riddleQueue").once("value"), db.ref("codebot/answers").once("value")]);
    const used = new Set(Object.keys(usedSnap.val() || {}));
    const texts = new Set();
    for(const w of Object.values(ridSnap.val() || {})){ if(w && w.text) texts.add(normText(w.text)); }
    const queue = Object.entries(queueSnap.val() || {}).map(([id,r]) => Object.assign({id}, r))
      .filter(r => r && r.q && !used.has(r.id) && !texts.has(normText(r.q)))
      .sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    const answers = new Set();
    for(const a of Object.values(ansSnap.val() || {})) if(a && a.answer) answers.add(normText(a.answer));
    for(const r of queue) answers.add(normText(r.a));
    return {used, texts, queue, answers};
  }
  function pickRiddle(info){
    if(info.queue && info.queue.length){ const r = info.queue[0]; return {id:r.id, q:r.q, a:r.a, alts:r.alts||[], ai:true}; }
    const pool = RIDDLES.filter(r => !info.used.has(r.id) && !info.texts.has(normText(r.q)));
    if(pool.length) return pool[Math.floor(Math.random()*pool.length)];
    for(let i=0;i<300;i++){
      const r = generateRiddle();
      if(!info.used.has(r.id) && !info.texts.has(normText(r.q))) return r;
    }
    return null;
  }
  function riddlesLeft(info){
    return RIDDLES.filter(r => !info.used.has(r.id) && !info.texts.has(normText(r.q))).length;
  }

  // Puts `riddle` on `week`. Without force it only fills an EMPTY week; with
  // force it replaces the current riddle and clears old submissions.
  async function setBotRiddle(week, riddle, force){
    const ref = db.ref(`riddles/week_${week}`);
    const res = await ref.transaction(cur => {
      if(cur && cur.locked) return;            // never touch a finished week
      if(cur && cur.text && !force) return;    // someone already set one
      const next = Object.assign({}, cur || {}, {text:riddle.q, answer:"", revealed:false, byCodeBot:true});
      delete next.answerAlts;
      if(force) delete next.submissions;
      return next;
    });
    if(!res.committed || !res.snapshot.val() || res.snapshot.val().text !== riddle.q) return false;
    await db.ref(`codebot/answers/week_${week}`).set({
      answer:riddle.a, alts:riddle.alts||[], text:riddle.q, riddleId:riddle.id, setAt:Date.now()});
    await db.ref(`codebot/usedRiddles/${riddle.id}`).set({week, at:Date.now()});
    if(String(riddle.id).startsWith("ai_")) await db.ref(`codebot/riddleQueue/${riddle.id}`).remove();
    return true;
  }

  // Checks an AI-written riddle before it's allowed in the queue: clean,
  // a real question, a short answer that isn't given away in the question,
  // and not a repeat of any riddle/answer used before.
  function validateAIRiddle(r, info){
    if(!r || typeof r.question !== "string" || typeof r.answer !== "string") return "bad format";
    const q = r.question.trim().replace(/\s+/g," "), a = r.answer.trim().replace(/[.!?]+$/,"");
    if(q.length < 25 || q.length > 320 || !q.endsWith("?")) return "question length/format";
    const aTok = tokens(a);
    if(!aTok.length || aTok.length > 3 || a.length > 30) return "answer too long";
    const qTok = tokens(q);
    if(aTok.some(t => t.length > 2 && qTok.some(w => wordEq(w, t)))) return "answer appears in the question";
    if(!moderate(q, {allowCaps:true}).ok || !moderate(a, {allowCaps:true}).ok) return "not clean";
    if(info.texts.has(normText(q)) || info.answers.has(normText(a))) return "repeat";
    if(RIDDLES.some(b => normText(b.a) === normText(a) || normText(b.q) === normText(q))) return "same as a bank riddle";
    const alts = (Array.isArray(r.alternates) ? r.alternates : []).map(x => String(x).trim()).filter(x => x && x.length <= 30 && tokens(x).length <= 4 && moderate(x,{allowCaps:true}).ok).slice(0,4);
    return {q, a, alts};
  }

  // Asks the local AI for riddles until `count` good ones are queued.
  let fillingQueue = false;
  async function fillRiddleQueue(count, maxTries){
    const AI = window.cnCodeBotAI;
    if(!AI || !AI.llmReady() || fillingQueue) return {added:0};
    fillingQueue = true;
    let added = 0, tries = 0;
    try{
      let info = await usedRiddleInfo();
      while(info.queue.length + added < count && tries < (maxTries || count*4)){
        tries++;
        let out;
        try{ out = await AI.writeRiddle([...info.answers]); }catch(e){ console.warn("AI riddle failed:", e); continue; }
        const v = validateAIRiddle(out, info);
        if(typeof v === "string") continue;
        const id = "ai_" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
        await db.ref(`codebot/riddleQueue/${id}`).set({q:v.q, a:v.a, alts:v.alts, createdAt:Date.now()});
        info.texts.add(normText(v.q)); info.answers.add(normText(v.a));
        added++;
      }
    } finally { fillingQueue = false; }
    if(added) logAction(`AI wrote ${added} riddle${added===1?"":"s"} for the queue.`);
    return {added, tries};
  }

  async function ensureCurrentRiddle(){
    const cw = window.getCurrentWeek();
    const snap = await db.ref(`riddles/week_${cw}/text`).once("value");
    if(snap.val()) return {status:"exists"};
    const riddle = pickRiddle(await usedRiddleInfo());
    if(!riddle) return {status:"none_left"};
    const ok = await setBotRiddle(cw, riddle, false);
    if(ok) logAction(`Set Week ${cw}'s riddle (${riddle.id}).`);
    return {status: ok ? "set" : "exists", riddle};
  }

  // Latest submission per ninja, then the earliest correct one wins —
  // identical to how the Riddle tab orders/crowns answers.
  function gradeSubmissions(subs, answer, alts){
    const latest = {};
    for(const s of Object.values(subs || {})){
      if(!s || !s.name) continue;
      const k = String(s.name).trim().toLowerCase();
      if(!latest[k] || (s.ts||0) > (latest[k].ts||0)) latest[k] = s;
    }
    const all = Object.values(latest);
    const correct = all.filter(s => answerMatches(s.answer, answer, alts)).sort((a,b)=>(a.ts||0)-(b.ts||0));
    return {total:all.length, correct, winner: correct[0] || null};
  }

  async function officialAnswerFor(week, w){
    const bot = (await db.ref(`codebot/answers/week_${week}`).once("value")).val();
    const botMatches = bot && bot.text === w.text;
    if(w.revealed && w.answer) return {answer:w.answer, alts: botMatches ? (bot.alts||[]) : (w.answerAlts||[])};
    if(botMatches) return {answer:bot.answer, alts:bot.alts||[]};
    return null;
  }

  async function finalizeWeek(week, opts){
    opts = opts || {};
    const w = (await db.ref(`riddles/week_${week}`).once("value")).val();
    if(!w || !w.text) return {status:"no_riddle"};
    if(w.locked) return {status:"already_locked", winner:w.winner||null};
    const official = await officialAnswerFor(week, w);
    if(!official) return {status:"needs_answer"};
    const stamp = Date.now() + "_" + Math.random().toString(36).slice(2,8);
    const res = await db.ref(`riddles/week_${week}`).transaction(cur => {
      if(cur === null) return null;      // let Firebase fetch the real value
      if(cur.locked) return;              // another tab beat us to it
      const g = gradeSubmissions(cur.submissions, official.answer, official.alts);
      return Object.assign({}, cur, {
        answer: String(official.answer).toLowerCase(), answerAlts: official.alts,
        revealed:true, winner: g.winner ? g.winner.name : null,
        locked:true, lockedBy:"codebot", lockStamp:stamp});
    });
    const final = res.snapshot && res.snapshot.val();
    if(!res.committed || !final || final.lockStamp !== stamp) return {status:"already_locked"};
    const g = gradeSubmissions(final.submissions, official.answer, official.alts);
    const result = {status:"locked", week, winner: final.winner || null, answer: official.answer,
      correctCount: g.correct.length, total: g.total};
    const cw = window.getCurrentWeek();
    await announceResult(result, opts.announce !== false && week >= cw - CHAT_RECENT_WEEKS);
    return result;
  }

  function resultText(r){
    const ans = `The answer was **"${r.answer}"**.`;
    if(r.winner){
      const others = r.correctCount - 1;
      return `🧩 Week ${r.week} riddle results! ${ans} 🏆 Congratulations **${r.winner}** — first to solve it!` +
        (others > 0 ? ` ${others} other ninja${others===1?"":"s"} got it right too. 👏` : "");
    }
    return `🧩 Week ${r.week} riddle results! ${ans} 🤷 Nobody got it correct this week` +
      (r.total ? ` (${r.total} guess${r.total===1?"":"es"} were made).` : ".") + " Better luck on the new riddle!";
  }
  async function announceResult(r, toChat){
    const text = resultText(r);
    await db.ref("codebot/announcements").push().set({week:r.week, winner:r.winner, answer:r.answer, text, ts:Date.now()});
    if(toChat){
      const plain = text.replace(/\*\*/g,"") + " A new riddle is up on the Riddle tab! 🧠";
      await db.ref("chat/messages").push().set({senderName:"CodeBot", role:"bot", text:plain, ts:Date.now()});
    }
    logAction(`Locked Week ${r.week}: ${r.winner ? "winner " + r.winner : "no winner"}.`);
  }

  async function finalizePastWeeks(opts){
    const cw = window.getCurrentWeek();
    const all = (await db.ref("riddles").once("value")).val() || {};
    const out = [];
    for(const key of Object.keys(all)){
      const wk = parseInt(key.replace("week_",""), 10);
      if(!(wk < cw)) continue;
      const w = all[key];
      if(!w || !w.text || w.locked) continue;
      const r = await finalizeWeek(wk, opts);
      if(r.status === "needs_answer" && wk < cw - NEEDS_ANSWER_LOOKBACK) continue;
      out.push(Object.assign({week:wk}, r));
    }
    return out;
  }

  let engineBusy = false;
  async function runWeekly(){
    if(engineBusy) return;
    engineBusy = true;
    try{
      const fin = await finalizePastWeeks();
      await ensureCurrentRiddle();
      const needs = fin.filter(r => r.status === "needs_answer").map(r => r.week);
      if(needs.length) notifyAdmin(`I couldn't grade Week ${needs.join(", ")} because I don't know the answer (the riddle was written by hand). Tell me: **answer for week ${needs[0]} is ...**`, "needs_"+needs.join("_"));
    }catch(e){ console.warn("CodeBot weekly run failed:", e); }
    engineBusy = false;
  }

  function logAction(text){
    try{ db.ref("codebot/actions").push().set({text, ts:Date.now()}); }catch(e){}
  }

  // -------------------------------------------------------------------------
  // Moderation — every Ninja Chat message and every new poll goes through
  // moderate() before it's saved. Smarter than plain substring matching:
  //  • whole-word matching for mild words, so "hello"/"scrap"/"shell" are fine
  //  • strong words/slurs are caught inside other words ("bullsh*t"), with a
  //    whitelist for innocent words (cockpit, peacock, grapes, shiitake…)
  //  • catches disguises: l33t/symbols (sh!t, $hit), stretched letters
  //    (fuuuck), spaced letters (f u c k), and * wildcards (f*ck)
  //  • also blocks bullying phrases, personal info (phone, email, address),
  //    links, and spam
  // The Sensei-managed list at moderation/badWords is checked too.
  // -------------------------------------------------------------------------
  const MOD_SEVERE = ["fuck","shit","bitch","cunt","whore","slut","asshole","porn","rape","retard","dick","cock","pussy","nigger","nigga","faggot","fag","motherf","bastard","jackass","dumbass","wanker"];
  const MOD_SLURS = new Set(["nigger","nigga","faggot","fag","retard"]);
  const MOD_WHITELIST = ["cockpit","peacock","cocktail","cockroach","hancock","cockatoo","cockatiel","shuttlecock","cocky","dickens","dickinson","retardant",
    "grape","drape","scrape","trapeze","rapeseed","parapet","shitake","shiitake","pussycat","pussywillow","scunthorpe","assassin","passcode"];
  const MOD_MILD = ["damn","hell","crap","piss","ass","sex","sexy","nude","naked","boob","boobs","penis","vagina","stfu","wtf","idiot","stupid","dumb","loser","ugly","moron","kys","nazi","horny"];
  const MOD_PHRASES = [
    {p:"kill yourself", cat:"unkind"},{p:"kill urself", cat:"unkind"},{p:"go die", cat:"unkind"},{p:"kill you", cat:"unkind"},
    {p:"i hate you", cat:"unkind"},{p:"hate you", cat:"unkind"},{p:"you suck", cat:"unkind"},{p:"u suck", cat:"unkind"},
    {p:"shut up", cat:"unkind"},{p:"nobody likes you", cat:"unkind"},{p:"everyone hates you", cat:"unkind"},
    {p:"you are ugly", cat:"unkind"},{p:"youre ugly", cat:"unkind"},{p:"you are stupid", cat:"unkind"},{p:"youre stupid", cat:"unkind"},
    {p:"hurt you", cat:"unkind"},{p:"beat you up", cat:"unkind"},{p:"my password is", cat:"personal_info"},{p:"my address is", cat:"personal_info"},
    {p:"i live at", cat:"personal_info"},{p:"my phone number", cat:"personal_info"},
  ];
  const MOD_REASONS = {
    profanity:"That has language that isn't allowed here.",
    slur:"That has a hurtful slur — that's never okay here.",
    unkind:"That sounds unkind or threatening. Let's keep the dojo friendly.",
    personal_info:"Please don't share personal info (phone, email, address, passwords).",
    link:"Links aren't allowed — keep it to text.",
    spam:"That looks like spam (too many repeated letters or ALL CAPS).",
  };
  const LEET = {"0":"o","1":"i","3":"e","4":"a","5":"s","7":"t","8":"b","@":"a","$":"s","!":"i","|":"i","+":"t"};

  // "nigger" -> /n+i+g{2,}e+r+/ : tolerates stretched letters but never
  // shrinks a double letter (so it can't match "night"/"niger").
  const runRegexCache = {};
  function runPattern(word){
    if(runRegexCache[word]) return runRegexCache[word];
    let out = "", i = 0;
    while(i < word.length){
      let j = i; while(j < word.length && word[j] === word[i]) j++;
      const ch = word[i].replace(/[^a-z0-9]/g, "\\$&");
      out += (j - i > 1) ? `${ch}{${j-i},}` : `${ch}+`;
      i = j;
    }
    return (runRegexCache[word] = out);
  }
  function modForms(text){
    const lower = String(text||"").toLowerCase();
    const leet = lower.replace(/[0134578@$!|+]/g, c => LEET[c] || c);
    const forms = [lower, leet];
    // Spaced/dotted letters: "f u c k", "s.h.i.t" -> "fuck", "shit"
    for(const src of [lower, leet]){
      const joined = src.replace(/\b(?:[a-z][\s.\-_*]+){2,}[a-z]\b/g, m => m.replace(/[^a-z]/g, ""));
      if(joined !== src) forms.push(joined);
    }
    return forms.map(f => f.replace(/[^a-z\s*#]/g, " ").replace(/\s+/g, " ").trim());
  }
  function isWhitelisted(token){ return MOD_WHITELIST.some(w => token.includes(w)); }

  function moderate(text, opts){
    opts = opts || {};
    const raw = String(text||"");
    if(!raw.trim()) return {ok:true};
    const extra = (window._cnBadWordsCache || []).map(w => String(w).toLowerCase().trim()).filter(Boolean);
    const fail = cat => ({ok:false, category:cat, reason:MOD_REASONS[cat] || MOD_REASONS.profanity});

    // Personal info + links (checked on the raw text)
    if(/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i.test(raw)) return fail("personal_info");
    if(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(raw)) return fail("personal_info");
    if(/\b\d{1,5}\s+[a-z]+(?:\s+[a-z]+)?\s+(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|court|ct|boulevard|blvd|way|circle|cir|place|pl)\b/i.test(raw)) return fail("personal_info");
    if(!opts.allowLinks && /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|gg|tv|xyz|co|me|ly|app|link)\b)/i.test(raw)) return fail("link");

    for(const form of modForms(raw)){
      const tokens = form.split(" ").filter(Boolean);
      const padded = " " + tokens.join(" ") + " ";
      for(const tok of tokens){
        const clean = tok.replace(/[*#]/g, "");
        // Strong words / slurs, even inside other words
        for(const w of MOD_SEVERE){
          if(new RegExp(runPattern(w)).test(clean) && !isWhitelisted(clean)){
            // Slurs + short stems only count as (near-)whole words, to avoid false hits
            if(w.length <= 4 && !new RegExp(`^${runPattern(w)}(?:s|es|ed|ing|er|ers|y|ty|face|head|hole)?$`).test(clean) &&
               !["fuck","shit","cunt"].includes(w)) continue;
            return fail(MOD_SLURS.has(w) ? "slur" : "profanity");
          }
        }
        // Mild words: whole word (+ simple endings) only
        for(const w of MOD_MILD.concat(extra.filter(x => !x.includes(" ")))){
          if(new RegExp(`^${runPattern(w.replace(/[^a-z]/g,""))}(?:s|es|ed|ing|er|ers|est|y|ier|iest|ness|ity)?$`).test(clean)) return fail("profanity");
        }
        // Wildcards: "f*ck", "sh#t"
        if(/[*#]/.test(tok) && /[a-z]/.test(tok) && tok.length >= 3){
          const re = new RegExp("^" + tok.replace(/[*#]/g, "[a-z]") + "$");
          if(MOD_SEVERE.concat(MOD_MILD).some(w => re.test(w))) return fail("profanity");
        }
      }
      // Phrases (built-in + multi-word entries from the Sensei list)
      const phrases = MOD_PHRASES.concat(extra.filter(x => x.includes(" ")).map(p => ({p, cat:"profanity"})));
      for(const {p, cat} of phrases){
        const pat = p.split(" ").map(runPattern).join(" ");
        if(new RegExp(` ${pat}(?:s|ed|ing)? `).test(padded)) return fail(cat);
      }
    }

    // Spam: one character repeated a lot, or long ALL-CAPS shouting
    if(!opts.allowCaps){
      if(/(.)\1{11,}/.test(raw)) return fail("spam");
      const letters = raw.replace(/[^a-zA-Z]/g, "");
      if(letters.length >= 15 && letters === letters.toUpperCase()) return fail("spam");
    }
    return {ok:true};
  }

  // Rules first (instant), then the local AI model when it's loaded.
  async function moderateAsync(text, opts){
    const v = moderate(text, opts);
    if(!v.ok) return v;
    const AI = window.cnCodeBotAI;
    if(AI && AI.moderationReady()){
      try{ const a = await AI.classify(text); if(a && !a.ok) return a; }catch(e){ console.warn("AI moderation failed:", e); }
    }
    return {ok:true};
  }
  async function moderatePollAsync(title, options){
    const v = moderatePoll(title, options);
    if(!v.ok) return v;
    const all = [title].concat(options || []);
    // Polls that single out a specific ninja ("Should Arjun be kicked out?")
    // are where poll bullying happens, and the AI scores them as harmless —
    // so any poll naming a registered ninja waits for a Sensei.
    try{
      const firsts = [...new Set((await window.fbUsernames.getAll()).map(firstNameOf).filter(n => n.length >= 3))];
      for(const t of all){
        const toks = tokens(t);
        const hit = firsts.find(n => toks.includes(n));
        if(hit) return {ok:false, category:"names_person", field: t === title ? "title" : "option",
          reason:"It mentions a specific ninja by name, so a Sensei will check it first."};
      }
    }catch(e){}
    const AI = window.cnCodeBotAI;
    if(AI && AI.moderationReady()){
      for(const t of all){
        try{ const a = await AI.classify(t, {strict:true}); if(a && !a.ok) return Object.assign({field: t === title ? "title" : "option"}, a); }catch(e){}
      }
    }
    return {ok:true};
  }

  function moderatePoll(title, options){
    for(const t of [title].concat(options || [])){
      const v = moderate(t, {allowCaps:true});
      if(!v.ok) return Object.assign({field: t === title ? "title" : "option"}, v);
    }
    return {ok:true};
  }

  // Records a blocked/removed item for Sensei review. Using a fixed key when
  // one is given keeps several open tabs from logging the same thing twice.
  async function logModeration(entry, key){
    const data = Object.assign({ts:Date.now(), by:"codebot"}, entry);
    if(key) await db.ref(`moderation/flags/${key}`).set(data);
    else await db.ref("moderation/flags").push().set(data);
  }

  // Second line of defence: anything that reaches chat/messages without
  // passing through the chat page (an old cached page, a direct database
  // write) is removed by whichever tab sees it first.
  async function sweepChatMessage(id, m){
    if(!m || m.role === "admin" || m.role === "bot") return;
    const v = await moderateAsync(m.text);
    if(v.ok) return;
    try{ await db.ref(`chat/messages/${id}`).remove(); }catch(e){ return; }
    await logModeration({source:"chat", status:"removed", username:m.senderName||"", accountKey:window.cnKeySafe(m.senderName||""),
      text:String(m.text||"").slice(0,300), category:v.category}, "chat_"+id);
  }

  // Auto-reviews polls: clean ones go live, flagged ones stay in Pending
  // with the reason attached for a Sensei to decide.
  async function reviewPoll(id){
    const stamp = Date.now();
    let verdict = null;
    const res = await db.ref(`polls/${id}`).transaction(cur => {
      if(cur === null) return null;
      if(cur.status !== "pending" || cur.modCheckedAt) return;
      verdict = moderatePoll(cur.title, cur.options);
      const next = Object.assign({}, cur, {modCheckedAt:stamp});
      if(verdict.ok){ next.status = "approved"; next.approvedBy = "codebot"; delete next.modFlag; }
      else next.modFlag = {category:verdict.category, reason:verdict.reason, field:verdict.field};
      return next;
    });
    const final = res.snapshot && res.snapshot.val();
    if(!res.committed || !final || final.modCheckedAt !== stamp) return null;
    if(final.status === "approved") logAction(`Approved poll "${final.title}".`);
    else await logModeration({source:"poll", status:"held", username:final.createdBy||"", accountKey:window.cnKeySafe(final.createdBy||""),
      text:final.title, category:final.modFlag && final.modFlag.category, pollId:id}, "poll_"+id);
    return final;
  }

  // When the AI moderation model finishes loading, re-check recent chat and
  // any polls it hasn't looked at yet (rules may have let them through).
  let aiSweepDone = false;
  async function aiSweep(){
    const AI = window.cnCodeBotAI;
    if(aiSweepDone || !AI || !AI.moderationReady()) return;
    aiSweepDone = true;
    const chat = (await db.ref("chat/messages").limitToLast(50).once("value")).val() || {};
    for(const [id, m] of Object.entries(chat)) await sweepChatMessage(id, m).catch(()=>{});
    const polls = (await db.ref("polls").once("value")).val() || {};
    for(const [id, p] of Object.entries(polls)){
      if(!p || p.aiCheckedAt) continue;
      if(!(p.status === "pending" && !p.modFlag) && p.approvedBy !== "codebot") continue;
      const v = await moderatePollAsync(p.title, p.options);
      const stamp = Date.now();
      const res = await db.ref(`polls/${id}`).transaction(cur => {
        if(cur === null) return null;
        if(cur.aiCheckedAt) return;
        const next = Object.assign({}, cur, {aiCheckedAt:stamp});
        if(!v.ok){ next.status = "pending"; delete next.approvedBy; next.modFlag = {category:v.category, reason:v.reason, field:v.field||null}; }
        return next;
      });
      const fin = res.snapshot && res.snapshot.val();
      if(!v.ok && res.committed && fin && fin.aiCheckedAt === stamp){
        await logModeration({source:"poll", status:"held", username:p.createdBy||"", accountKey:window.cnKeySafe(p.createdBy||""),
          text:p.title, category:v.category, pollId:id, ai:true}, "poll_"+id);
      }
    }
  }

  // codebot-ai.js loads after this file; it calls cnCodeBot._attachAI(api)
  // once it exists, which runs everything queued here.
  const aiHooks = [];
  function whenAI(fn){ if(window.cnCodeBotAI) fn(window.cnCodeBotAI); else aiHooks.push(fn); }
  function attachAI(api){ aiHooks.splice(0).forEach(fn => { try{ fn(api); }catch(e){ console.warn(e); } }); }

  function startModerationSweeps(){
    whenAI(AI => AI.onChange(() => { if(AI.moderationReady()) aiSweep().catch(e => console.warn(e)); }));
    db.ref("chat/messages").limitToLast(50).on("child_added", snap => { sweepChatMessage(snap.key, snap.val()).catch(()=>{}); });
    db.ref("chat/messages").limitToLast(50).on("child_changed", snap => { sweepChatMessage(snap.key, snap.val()).catch(()=>{}); });
    db.ref("polls").on("child_added", snap => {
      const p = snap.val();
      if(p && p.status === "pending" && !p.modCheckedAt) reviewPoll(snap.key).catch(()=>{});
    });
  }

  // -------------------------------------------------------------------------
  // Points helpers
  // -------------------------------------------------------------------------
  function groupDaily(entries){
    const map = {};
    for(const e of entries){
      if(!e || !e.name) continue;
      const k = `${e.week}|${e.name.trim().toLowerCase()}|${e.date}`;
      if(!map[k]) map[k] = {week:e.week, name:e.name, nameKey:e.name.trim().toLowerCase(), date:e.date, points:0, attempts:0};
      map[k].points += Number(e.points)||0; map[k].attempts++; map[k].name = e.name;
    }
    return Object.values(map);
  }
  // Week score = a ninja's single best day (same rule as the Points tab).
  function weekBoard(entries, week){
    const map = {};
    for(const d of groupDaily(entries.filter(e => e.week === week))){
      if(!map[d.nameKey]) map[d.nameKey] = {name:d.name, best:0, total:0, days:0};
      const m = map[d.nameKey];
      m.name = d.name; m.total += d.points; m.days++;
      if(d.points > m.best) m.best = d.points;
    }
    return Object.values(map).sort((a,b)=>b.best-a.best || b.total-a.total || a.name.localeCompare(b.name));
  }

  async function loadPeople(){
    const [entries, usernames] = await Promise.all([window.fbLeaderboard.getAll(), window.fbUsernames.getAll()]);
    return {entries, usernames};
  }

  // Resolves free text to ninja name(s): exact username / logged name first,
  // then first-name matches, then close spellings.
  function resolveNinja(raw, people){
    const q = String(raw||"").trim().replace(/^@/,"").replace(/[?!.,]+$/,"").toLowerCase();
    if(!q) return [];
    const names = new Map();
    for(const u of people.usernames) names.set(u.toLowerCase(), u);
    for(const e of people.entries) if(e && e.name && !names.has(e.name.trim().toLowerCase())) names.set(e.name.trim().toLowerCase(), e.name.trim());
    if(names.has(q)) return [names.get(q)];
    const byFirst = people.usernames.filter(u => firstNameOf(u) === q);
    if(byFirst.length) return byFirst;
    const fuzzy = [];
    for(const [lower, orig] of names){
      const d = Math.min(editDistance(q, lower), editDistance(q, firstNameOf(lower)));
      if(d <= (q.length > 4 ? 2 : 1)) fuzzy.push({orig, d});
    }
    fuzzy.sort((a,b)=>a.d-b.d);
    // Drop bare first names when the full account is also listed.
    const list = fuzzy.map(f => f.orig);
    return list.filter(n => n.includes(".") || !list.some(o => o.includes(".") && firstNameOf(o) === n.toLowerCase())).slice(0,6);
  }

  async function auditPoints(scope){
    const {entries, usernames} = await loadPeople();
    const cw = window.getCurrentWeek(), today = window.todayStr();
    const scoped = entries.filter(e => scope === "week" ? e.week === cw : e.date === today);
    const issues = [];
    // Too many attempts in a day
    for(const d of groupDaily(scoped)){
      if(d.attempts > MAX_ATTEMPTS) issues.push({sev:"high", text:`**${d.name}** has ${d.attempts} entries on ${d.date} (max is ${MAX_ATTEMPTS}).`});
    }
    // Bad point values
    for(const e of scoped){
      const p = Number(e.points);
      if(!Number.isFinite(p) || p < 0) issues.push({sev:"high", text:`**${e.name}** has an invalid points value (${e.points}) on ${e.date}.`});
    }
    // Unusually large entries (more than 3× the typical entry)
    const pts = scoped.map(e => Number(e.points)||0).filter(p => p > 0).sort((a,b)=>a-b);
    if(pts.length >= 5){
      const median = pts[Math.floor(pts.length/2)];
      for(const e of scoped){
        if((Number(e.points)||0) > Math.max(3*median, median+500))
          issues.push({sev:"med", text:`**${e.name}** got ${e.points} pts on ${e.date} — about ${Math.round(e.points/median)}× a typical entry (${median}). Typo?`});
      }
    }
    // Entries logged back-to-back for the same ninja
    const cooldown = window.ENTRY_COOLDOWN_MS || 20*60*1000;
    const byName = {};
    for(const e of scoped){ const k = e.name.trim().toLowerCase(); (byName[k] = byName[k] || []).push(e); }
    for(const list of Object.values(byName)){
      list.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
      for(let i=1;i<list.length;i++){
        const gap = (list[i].createdAt||0) - (list[i-1].createdAt||0);
        if(list[i].createdAt && list[i-1].createdAt && gap < cooldown)
          issues.push({sev:"low", text:`**${list[i].name}** has two entries only ${Math.max(1,Math.round(gap/60000))} min apart (${list[i-1].points} then ${list[i].points} pts) — possible double entry.`});
      }
    }
    // Ambiguous or misspelled names
    const userLower = new Set(usernames.map(u => u.toLowerCase()));
    const seenName = new Set();
    for(const e of scoped){
      const k = e.name.trim().toLowerCase();
      if(seenName.has(k) || userLower.has(k)) continue;
      seenName.add(k);
      const sameFirst = usernames.filter(u => firstNameOf(u) === k);
      if(sameFirst.length > 1){
        issues.push({sev:"med", text:`Entries under just **"${e.name}"** could belong to ${sameFirst.join(" or ")}. Fix with: rename ${e.name} to ${sameFirst[0]}`});
        continue;
      }
      if(sameFirst.length === 1) continue; // normal first-name entry
      const close = usernames.filter(u => editDistance(k, firstNameOf(u)) <= 2 || editDistance(k, u.toLowerCase()) <= 2);
      if(close.length) issues.push({sev:"low", text:`**"${e.name}"** isn't a registered ninja — did you mean ${close.slice(0,3).join(" / ")}?`});
    }
    return issues;
  }

  async function addPoints(name, points, hours){
    const cw = window.getCurrentWeek(), today = window.todayStr();
    const entries = await window.fbLeaderboard.getAll();
    const norm = window.cnNormalizeName ? window.cnNormalizeName(name) : name.trim();
    const todays = entries.filter(e => e && e.name && e.week === cw && e.date === today && e.name.trim().toLowerCase() === norm.toLowerCase());
    if(todays.length >= MAX_ATTEMPTS) return {ok:false, msg:`${norm} already has ${todays.length}/${MAX_ATTEMPTS} entries today — no more attempts allowed.`};
    // Login window is locked by the first entry of the day (same as Points tab).
    let useHours = window.cnCleanHours(hours || window.SESSION_HOURS), lockedNote = "";
    let first = null;
    if(todays.length){
      first = window.cnFirstEntryOfDay(todays) || todays[0];
      const locked = window.cnCleanHours(first.sessionHours);
      if(hours && hours !== locked) lockedNote = ` (sign-in stays ${locked}h — it was set by today's first entry)`;
      useHours = locked;
    }
    const res = await window.fbLeaderboard.addEntry(cw, norm, points, today, useHours);
    try{ sessionStorage.setItem("cn_codebot_last_add", JSON.stringify({week:cw, id:res.id, name:norm, points})); }catch(e){}
    logAction(`Added ${points} pts to ${norm}.`);
    const left = MAX_ATTEMPTS - (todays.length + 1);
    // Only the first entry of the day sets the end time; later ones never extend it.
    const endsAt = window.cnAccessEndsAt(first ? first.createdAt : Date.now(), useHours);
    const endsLabel = new Date(endsAt).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
    const timeNote = first
      ? `Sign-in time unchanged — still ends at ${endsLabel}.`
      : `Signed in for ${useHours}h (+${window.SESSION_GRACE_MIN||20} min), until ${endsLabel}. Check their goal on In The Dojo (keep it or change it).`;
    return {ok:true, msg:`✅ Added **${points} pts** to **${norm}** for today${lockedNote}. ${left} attempt${left===1?"":"s"} left today. ${timeNote} (Say **undo** to take it back.)`};
  }

  // -------------------------------------------------------------------------
  // Command handling (admin only)
  // -------------------------------------------------------------------------
  let pending = null; // {type:"choose", options, run(name)} | {type:"confirm", run()}

  const HELP = [
    "Here's what I can do, Sensei:",
    "**Points**",
    "• add 120 to Maya  (or: give 120 points to maya.lee for 3 hours — 1, 2 or 3)",
    "• stats Arjun  /  how is Maya doing?",
    "• leaderboard  /  leaderboard week 3",
    "• audit  /  audit week  — I check for double entries, too many attempts, typos, ambiguous names, odd scores",
    "• rename Arjun to arjun.patel  (today / this week / all)",
    "• undo  /  remove last entry for Maya",
    "• who's here  — everyone signed in, time left and their goal",
    "• goals  — today's goals and who still needs one",
    "• site time  — who's actively on this site and for how long",
    "• site time limit 15  /  site time limit off  — when the kiosk says \"get back to work\"",
    "**Riddle**",
    "• riddle  — this week's riddle, answer and how many got it",
    "• submissions",
    "• new riddle  — swap in a fresh unused one",
    "• set riddle: <question> answer: <answer>",
    "• answer is <answer>  /  answer for week 5 is <answer>",
    "• results  /  results week 4  /  grade now",
    "• riddles left",
    "**Moderation** (I check every chat message and new poll automatically)",
    "• moderation  — recently blocked messages / held polls",
    "• check: <some text>  — see if I'd allow it",
    "• ban maya.lee  /  unban maya.lee",
    "• polls  — pending polls and why I held them",
    "**Local AI** (runs on this computer, no internet service)",
    "• turn on ai  /  turn on small ai  /  turn off ai  /  ai status",
    "• once it's on, just ask in your own words: \"how are the two Arjuns doing?\"",
    "• write 3 riddles  /  riddle queue  /  drop queued riddle 2",
    "• ai moderation on / off",
    "**Other**: status, help",
    "Every week I automatically post a new riddle, then grade last week's, lock the winner (or announce that nobody got it) and post it in Ninja Chat. Clean polls go live right away, and anything inappropriate in chat is blocked before it sends."
  ].join("\n");

  async function statusReport(){
    const {entries} = await loadPeople();
    const cw = window.getCurrentWeek(), today = window.todayStr();
    const todays = entries.filter(e => e.date === today);
    const ninjasToday = new Set(todays.map(e => e.name.trim().toLowerCase())).size;
    const board = weekBoard(entries, cw);
    const w = (await db.ref(`riddles/week_${cw}`).once("value")).val() || {};
    const subs = Object.keys(w.submissions || {}).length;
    const issues = await auditPoints("today");
    const lines = [
      `📊 **${window.getWeekLabel(cw)}**`,
      `• Today: ${todays.length} entr${todays.length===1?"y":"ies"} for ${ninjasToday} ninja${ninjasToday===1?"":"s"}`,
      board.length ? `• Leading this week: **${board[0].name}** (best day ${board[0].best} pts)` : "• No points logged this week yet",
      w.text ? `• Riddle: ${subs} submission${subs===1?"":"s"} so far${w.byCodeBot ? " (I set this one)" : ""}` : "• Riddle: none set yet",
      issues.length ? `• ⚠️ ${issues.length} thing${issues.length===1?"":"s"} to check in today's points — say **audit**` : "• ✅ Today's points look clean",
    ];
    return lines.join("\n");
  }

  async function statsFor(name, people){
    const cw = window.getCurrentWeek(), today = window.todayStr();
    const lower = name.toLowerCase();
    const mine = people.entries.filter(e => e.name && e.name.trim().toLowerCase() === lower);
    const board = weekBoard(people.entries, cw);
    const idx = board.findIndex(b => b.name.trim().toLowerCase() === lower);
    const todayCount = mine.filter(e => e.date === today).length;
    const total = mine.reduce((t,e)=>t+(Number(e.points)||0),0);
    const daily = groupDaily(mine);
    const bestDay = daily.reduce((a,b)=>b.points>a.points?b:a, {points:0,date:"—"});
    const riddles = (await db.ref("riddles").once("value")).val() || {};
    const wins = Object.values(riddles).filter(r => r && r.winner && String(r.winner).toLowerCase() === lower).length;
    const breaks = await window.fbBreak.getAll();
    const onBreak = window.cnIsBreakActive(breaks[window.cnKeySafe(name)]);
    if(!mine.length) return `**${name}** has no Points entries yet.${wins?` Riddle wins: ${wins} 🏆`:""}`;
    return [
      `🥷 **${name}**`,
      idx >= 0 ? `• This week: rank **#${idx+1}** of ${board.length}, best day ${board[idx].best} pts, ${board[idx].days} day${board[idx].days===1?"":"s"} played` : "• This week: no points yet",
      `• Today: ${todayCount}/${MAX_ATTEMPTS} attempts used`,
      `• All-time: ${total} pts over ${daily.length} day${daily.length===1?"":"s"} · best day ${bestDay.points} pts (${bestDay.date})`,
      `• Riddle wins: ${wins}${onBreak ? " · ☕ on break right now" : ""}`,
    ].join("\n");
  }

  function leaderboardText(entries, week){
    const board = weekBoard(entries, week);
    if(!board.length) return `No points logged for Week ${week} yet.`;
    const medals = ["🥇","🥈","🥉"];
    return `🏆 **${window.getWeekLabel(week)}** — ranked by best single day\n` +
      board.slice(0,10).map((b,i)=>`${medals[i]||"#"+(i+1)} ${b.name} — ${b.best} pts`).join("\n") +
      (board.length > 10 ? `\n…and ${board.length-10} more` : "");
  }

  // Ninjas currently signed in: latest Points entry today + its sign-in
  // length (1/2/3h) + 20 min, minus anyone removed today. Returns rows with
  // `keys` = every account key that refers to them (Points name + linked account).
  async function presentNinjas(){
    const [entries, usernames, revoked] = await Promise.all([
      window.fbLeaderboard.getAll(), window.fbUsernames.getAll(), window.fbAccessRevocation.getAll()]);
    const today = window.todayStr(), now = Date.now();
    const out = [];
    for(const p of window.cnPresenceFromEntries(entries, today)){
      if(!p.lastSeen || now >= p.endsAt) continue;
      const linked = window.findLinkedAccount(p.name, usernames);
      const keys = [window.cnKeySafe(p.name)].concat(linked ? [window.cnKeySafe(linked)] : []);
      if(keys.some(k => revoked[k] && revoked[k].date === today)) continue;
      out.push(Object.assign({}, p, {linked, keys}));
    }
    return out;
  }

  // Goal line for one present ninja: saved goal + whether it's checked today.
  function goalLine(p, goals){
    const g = p.keys.map(k => goals[k]).find(x => x && x.goal);
    if(!g) return {g:null, text:"no goal yet", ok:false};
    const ok = window.cnGoalActive(g);
    return {g, ok, text: g.goal + (ok ? "" : ` (needs check — last set ${g.date||"earlier"})`)};
  }

  async function whoIsHere(){
    const here = (await presentNinjas()).sort((a,b)=>a.endsAt-b.endsAt);
    if(!here.length) return "Nobody is checked in right now.";
    const breaks = await window.fbBreak.getAll();
    const goals = await window.fbGoals.getAll();
    const now = Date.now();
    return `📍 **${here.length} in the dojo:**\n` + here.map(p => {
      const mins = Math.max(0, Math.round((p.endsAt - now)/60000));
      const key = p.keys[p.keys.length-1];
      const br = window.cnIsBreakActive(breaks[key]) ? " · ☕ on break" : "";
      return `• ${p.linked || p.name} — ${p.hours}h sign-in, ${mins} min left${br}\n   🎯 ${goalLine(p, goals).text}`;
    }).join("\n");
  }

  async function goalsReport(){
    const here = await presentNinjas();
    if(!here.length) return "Nobody is signed in right now. (Every ninja's saved project is on the **Ninjas** tab.)";
    const goals = await window.fbGoals.getAll();
    const ok = [], check = [], none = [];
    for(const p of here){
      const n = p.linked || p.name, gl = goalLine(p, goals);
      if(!gl.g) none.push(n);
      else if(gl.ok) ok.push(`• **${n}** (${gl.g.section}) — ${gl.g.goal}`);
      else check.push(`• **${n}** — last goal: ${gl.g.goal}`);
    }
    return `🎯 **Goals for today's ninjas**\n` + (ok.length ? ok.join("\n") : "• none checked yet today") +
      (check.length ? `\n⏳ **Needs a check** (keep or change on In The Dojo):\n${check.join("\n")}` : "") +
      (none.length ? `\n⚠️ **No goal yet:** ${none.join(", ")} — assign one on In The Dojo or the Ninjas tab.` : "") +
      (!check.length && !none.length ? "\n✅ Everyone's goal is set for today." : "");
  }

  async function riddleReport(week){
    const w = (await db.ref(`riddles/week_${week}`).once("value")).val();
    if(!w || !w.text) return `There's no riddle for Week ${week} yet.`;
    const official = await officialAnswerFor(week, w);
    const g = official ? gradeSubmissions(w.submissions, official.answer, official.alts) : null;
    const lines = [`🧩 **Week ${week} riddle**${w.byCodeBot?" (set by me)":""}`, `"${w.text}"`,
      official ? `Answer: **${official.answer}**${official.alts.length?` (also accepting: ${official.alts.join(", ")})`:""}` : "Answer: ❓ I don't know it — tell me with **answer is ...**"];
    if(w.locked) lines.push(w.winner ? `🔒 Locked — winner: **${w.winner}**` : "🔒 Locked — nobody got it");
    else if(g) lines.push(`${g.total} submission${g.total===1?"":"s"}, ${g.correct.length} correct${g.winner?` — **${g.winner.name}** is first right now`:""}`);
    else lines.push(`${Object.keys(w.submissions||{}).length} submissions`);
    return lines.join("\n");
  }

  async function submissionsReport(week){
    const w = (await db.ref(`riddles/week_${week}`).once("value")).val();
    if(!w || !w.text) return `No riddle for Week ${week}.`;
    const official = await officialAnswerFor(week, w);
    const latest = {};
    for(const s of Object.values(w.submissions||{})){
      const k = String(s.name||"").toLowerCase();
      if(!latest[k] || (s.ts||0) > (latest[k].ts||0)) latest[k] = s;
    }
    const list = Object.values(latest).sort((a,b)=>(a.ts||0)-(b.ts||0));
    if(!list.length) return `No submissions yet for Week ${week}.`;
    return `📝 **Week ${week} submissions** (oldest first)\n` + list.map(s => {
      const ok = official && answerMatches(s.answer, official.answer, official.alts);
      return `${official ? (ok ? "✅" : "❌") : "•"} ${s.name}: "${s.answer}"`;
    }).join("\n");
  }

  async function setAnswer(week, answer){
    const w = (await db.ref(`riddles/week_${week}`).once("value")).val();
    if(!w || !w.text) return `There's no riddle for Week ${week} to set an answer on.`;
    if(w.locked) return `Week ${week} is already locked, so I can't change its answer.`;
    const prev = (await db.ref(`codebot/answers/week_${week}`).once("value")).val();
    const alts = prev && prev.text === w.text ? (prev.alts||[]) : [];
    await db.ref(`codebot/answers/week_${week}`).set({answer:answer.trim(), alts, text:w.text, riddleId:(prev&&prev.riddleId)||"manual", setAt:Date.now()});
    logAction(`Answer for Week ${week} set to "${answer.trim()}".`);
    const cw = window.getCurrentWeek();
    if(week < cw){
      const r = await finalizeWeek(week);
      if(r.status === "locked") return `Got it. Week ${week} is graded and locked:\n${resultText(r)}`;
    }
    return `Got it — Week ${week}'s answer is **${answer.trim()}**. I'll grade it when the week ends.`;
  }

  function choose(options, run, prompt){
    pending = {type:"choose", options, run};
    return `${prompt || "Which one do you mean?"}\n` + options.map((o,i)=>`${i+1}. ${o}`).join("\n") + "\nReply with the number or the name.";
  }
  function confirmThen(question, run){
    pending = {type:"confirm", run};
    return `${question}\nReply **yes** to confirm or **no** to cancel.`;
  }

  async function withNinja(raw, run){
    const people = await loadPeople();
    const matches = resolveNinja(raw, people);
    if(!matches.length) return `I couldn't find a ninja called "${raw.trim()}".`;
    if(matches.length === 1) return run(matches[0], people);
    return choose(matches, n => run(n, people), `More than one ninja matches "${raw.trim()}":`);
  }

  // Context the AI brain may use to answer questions (it must not invent facts).
  async function aiContext(){
    const {entries} = await loadPeople();
    const cw = window.getCurrentWeek();
    return [await statusReport(), leaderboardText(entries, cw)].join("\n").replace(/\*\*/g,"");
  }
  const MUTATING = /^(add|give|log|award|enter)\b|^answer\b|^grade\b/i;

  async function handleCommand(input){
    const sess = window.cnSession && window.cnSession.getSession();
    if(!sess || sess.role !== "admin") return "Sorry — I only take questions and commands from Senseis.";
    const ruled = await ruleCommand(input);
    const AI = window.cnCodeBotAI;
    // A half-recognised sentence ("how are the two Arjuns doing") gets a
    // second chance with the AI brain instead of a dead-end reply.
    const deadEnd = typeof ruled === "string" && /^I couldn't find a ninja called/.test(ruled);
    if(ruled !== null && !(deadEnd && AI && AI.llmReady())) return ruled;
    if(AI && AI.llmReady()){
      let intent;
      try{ intent = await AI.interpret(String(input), await aiContext()); }
      catch(e){ console.warn(e); return "My AI brain hit a snag on that one. Try rephrasing, or type **help**."; }
      if(intent && intent.action === "command" && intent.command){
        const cmd = String(intent.command).trim();
        if(MUTATING.test(cmd)){
          return confirmThen(`🧠 I think you want: **${cmd}**. Should I do it?`, async () => (await ruleCommand(cmd)) ?? `Hmm, "${cmd}" didn't work.`);
        }
        const out = await ruleCommand(cmd);
        if(out !== null) return `🧠 (I read that as: ${cmd})\n` + out;
      }
      if(intent && intent.answer) return "🧠 " + String(intent.answer).slice(0, 800);
      return "I'm not sure what you mean. Type **help** to see what I can do.";
    }
    return "I didn't catch that. Try **status**, **audit**, **add 100 to Maya**, **riddle**, or **help**." +
      (AI ? " (Tip: say **turn on ai** so I can understand everyday wording.)" : "");
  }

  async function ruleCommand(input){
    const text = String(input||"").trim();
    const lower = text.toLowerCase();
    if(!text) return "";
    const cw = window.getCurrentWeek();
    const weekMatch = lower.match(/week\s*(\d+)/);
    const week = weekMatch ? parseInt(weekMatch[1],10) : null;

    // Follow-ups to a question I asked
    if(pending){
      const p = pending;
      if(p.type === "confirm"){
        if(/^(y|yes|yep|yeah|confirm|do it|ok|okay|sure)\b/.test(lower)){ pending = null; return p.run(); }
        if(/^(n|no|nope|cancel|stop|never ?mind)\b/.test(lower)){ pending = null; return "Okay, cancelled."; }
      } else if(p.type === "choose"){
        const num = parseInt(lower, 10);
        let pick = null;
        if(Number.isFinite(num) && num >= 1 && num <= p.options.length) pick = p.options[num-1];
        else pick = p.options.find(o => o.toLowerCase() === lower) || null;
        if(pick){ pending = null; return p.run(pick); }
        if(/^(cancel|never ?mind|no)\b/.test(lower)){ pending = null; return "Okay, cancelled."; }
      }
      pending = null; // anything else = new command
    }

    if(/^(help|commands|\?|what can you do|menu)/.test(lower)) return HELP;
    if(/^(hi|hello|hey|yo|sup)\b/.test(lower)) return "Hey Sensei! 👋\n" + await statusReport();

    // ── Local AI ──
    const AI = window.cnCodeBotAI;
    if(/^(turn on|enable|load|start)\s+(the\s+)?(ai|brain|smart mode)\b/.test(lower)){
      if(!AI) return "The AI module (codebot-ai.js) isn't loaded on this page.";
      const size = /\b(small|lite|light|tiny)\b/.test(lower) ? "small" : "standard";
      const gpu = await AI.webgpuInfo();
      if(!gpu.ok) return `🧠 I can't run my AI brain on this computer: ${gpu.why} I'll keep working on my built-in rules.`;
      AI.setAutoLLM(size);
      AI.loadLLM(size).then(ok => { if(ui) ui.push("bot", ok ? `🧠 AI brain is ready (${AI.modelLabel()}). Ask me things in your own words!` : `🧠 The AI brain couldn't load: ${AI.status().llm.error}`, true); });
      AI.loadModeration();
      return `🧠 Loading my AI brain (${AI.modelLabel()}) on this computer. The first time is a big download (${size==="small"?"~0.5":"~1"} GB) — after that it's cached and starts much faster. Progress shows at the top of this panel. It will auto-start on this computer from now on.`;
    }
    if(/^(turn off|disable|unload|stop)\s+(the\s+)?(ai|brain|smart mode)\b/.test(lower)){
      if(!AI) return "The AI isn't loaded.";
      AI.setAutoLLM(""); await AI.unloadLLM();
      return "🧠 AI brain is off on this computer. I'm back to my built-in rules (they still do everything — I just need exact commands).";
    }
    if(/^ai moderation (on|off)\b/.test(lower)){
      if(!AI) return "The AI module isn't loaded on this page.";
      const on = /on\b/.test(lower.split("moderation")[1]);
      await AI.setModerationEnabled(on);
      return on ? "🛡️ AI moderation is **on** — chat and polls are checked by my model as well as my word rules (on devices where it has loaded)."
                : "🛡️ AI moderation is **off** everywhere. My word rules still check every message and poll.";
    }
    if(/^(ai status|ai\??)$/.test(lower)){
      if(!AI) return "The AI module isn't loaded on this page.";
      const s = AI.status();
      const st = x => x.state === "ready" ? "✅ ready" : x.state === "loading" ? `⏳ loading ${x.progress}%` : x.state === "error" ? `❌ ${x.error}` : "off";
      return `🧠 **Sensei brain** (${AI.modelLabel()}, this computer): ${st(s.llm)}\n🛡️ **Moderation model** (this page): ${st(s.moderation)} · ${s.moderation.enabled ? "enabled" : "disabled by a Sensei"}\nSay **turn on ai**, **turn on small ai** (for slower computers), **turn off ai**, or **ai moderation on/off**.`;
    }
    if(/\b(write|make|generate|create)\b.*\briddles?\b/.test(lower) && !/^set riddle/.test(lower)){
      if(!AI || !AI.llmReady()) return "I need my AI brain to write riddles — say **turn on ai** first. (I'll keep using my riddle bank meanwhile.)";
      const nMatch = lower.match(/\b(\d+)\b/);
      const want = Math.min(10, Math.max(1, nMatch ? parseInt(nMatch[1],10) : 3));
      const before = (await usedRiddleInfo()).queue.length;
      const r = await fillRiddleQueue(before + want, want*4);
      const q = (await usedRiddleInfo()).queue;
      if(!r.added) return "I tried, but none of the riddles I wrote passed my quality checks. Try again in a moment.";
      return `🧠 I wrote **${r.added}** new riddle${r.added===1?"":"s"} (after ${r.tries} tries — I throw out ones that are unclear, repeated or give the answer away). Queue:\n` +
        q.map((x,i)=>`${i+1}. "${x.q}" → **${x.a}**`).join("\n") + "\nSay **drop queued riddle N** to remove one.";
    }
    if(/\briddle queue\b|\bqueued riddles\b/.test(lower)){
      const q = (await usedRiddleInfo()).queue;
      if(!q.length) return "📥 The AI riddle queue is empty — I'll use my built-in bank. Say **write 3 riddles** (AI brain needed) to fill it.";
      return "📥 **AI riddle queue** (used first, oldest first):\n" + q.map((x,i)=>`${i+1}. "${x.q}" → **${x.a}**${x.alts&&x.alts.length?` (also: ${x.alts.join(", ")})`:""}`).join("\n");
    }
    let dq = lower.match(/^(?:drop|delete|remove)\s+queued riddle\s+(\d+)/);
    if(dq){
      const q = (await usedRiddleInfo()).queue;
      const item = q[parseInt(dq[1],10)-1];
      if(!item) return "There's no queued riddle with that number.";
      await db.ref(`codebot/riddleQueue/${item.id}`).remove();
      return `🗑️ Dropped "${item.q}".`;
    }

    // ── Moderation ──
    let m = text.match(/^(?:check|test|would you allow)[:\s]+(.+)$/i);
    if(m){
      const v = moderate(m[1]);
      return v.ok ? "✅ I'd allow that." : `🚫 I'd block that — ${v.category.replace("_"," ")}: ${v.reason}`;
    }
    m = text.match(/^(un)?ban\s+(.+)$/i);
    if(m){
      const unban = !!m[1];
      return withNinja(m[2], n => confirmThen(`${unban?"Unban":"Ban"} **${n}**?${unban?"":" They'll be signed out and can't log back in until unbanned."}`, async () => {
        const key = window.cnKeySafe(n);
        await window.fbModeration.setBan(key, !unban, null);
        if(!unban) await window.cnSession.forceLogoutKey(key);
        logAction(`${unban?"Unbanned":"Banned"} ${n}.`);
        return unban ? `✅ ${n} is unbanned.` : `⛔ ${n} is banned and signed out.`;
      }));
    }
    if(/\b(moderation|flags?|flagged|blocked|filtered)\b/.test(lower)){
      const snap = await db.ref("moderation/flags").limitToLast(15).once("value");
      const list = Object.values(snap.val()||{}).sort((a,b)=>(b.ts||0)-(a.ts||0));
      if(!list.length) return "🛡️ Nothing has been blocked recently.";
      return "🛡️ **Recent moderation:**\n" + list.map(f => {
        const when = new Date(f.ts||0).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
        const what = f.source === "poll" ? "poll held" : f.status === "banned" ? "banned" : f.status === "removed" ? "message removed" : "message blocked";
        return `• ${when} — **${f.username||"?"}** (${what}, ${String(f.category||"inappropriate").replace("_"," ")}): "${String(f.text||"").slice(0,60)}"`;
      }).join("\n") + "\nSay **ban <name>** if someone needs a time-out.";
    }
    if(/\bpolls?\b/.test(lower) && !/\briddle\b/.test(lower)){
      const all = Object.entries((await db.ref("polls").once("value")).val()||{}).map(([id,p])=>({id,...p}));
      const pend = all.filter(p => p.status === "pending");
      const approvedByMe = all.filter(p => p.approvedBy === "codebot").length;
      if(!pend.length) return `📊 No polls waiting. I've auto-approved ${approvedByMe} poll${approvedByMe===1?"":"s"} so far.`;
      return `📊 **${pend.length} poll${pend.length===1?"":"s"} waiting** (review them on the Polls tab → Pending):\n` +
        pend.map(p => `• "${String(p.title||"").slice(0,60)}" by ${p.createdBy||"?"} — ${p.modFlag ? "🚩 " + p.modFlag.reason : "not checked yet"}`).join("\n");
    }

    // ── Points: add ──
    m = text.match(/^(?:add|give|log|award|enter)\s+(\d+)\s*(?:points?|pts)?\s+(?:to|for)\s+(.+?)(?:\s+for\s+([123])\s*(?:h|hrs?|hours?))?\s*$/i)
         || null;
    let addName, addPts, addHrs;
    if(m){ addPts = parseInt(m[1],10); addName = m[2]; addHrs = m[3] ? parseInt(m[3],10) : null; }
    else{
      m = text.match(/^(?:add|give|log|award|enter)\s+(.+?)\s+(\d+)\s*(?:points?|pts)?(?:\s+for\s+([123])\s*(?:h|hrs?|hours?))?\s*$/i);
      if(m){ addName = m[1]; addPts = parseInt(m[2],10); addHrs = m[3] ? parseInt(m[3],10) : null; }
    }
    if(addName){
      if(!(addPts >= 0)) return "Points must be zero or more.";
      return withNinja(addName, async n => {
        const r = await addPoints(n, addPts, addHrs);
        return r.msg;
      });
    }

    // ── Points: undo / remove ──
    if(/^undo\b/.test(lower)){
      let last = null;
      try{ last = JSON.parse(sessionStorage.getItem("cn_codebot_last_add")||"null"); }catch(e){}
      if(!last) return "There's nothing of mine to undo in this tab.";
      return confirmThen(`Remove the ${last.points}-pt entry I added for **${last.name}**?`, async () => {
        await window.fbLeaderboard.deleteEntry(last.week, last.id);
        sessionStorage.removeItem("cn_codebot_last_add");
        logAction(`Undid ${last.points} pts for ${last.name}.`);
        return `↩️ Removed ${last.name}'s ${last.points}-pt entry.`;
      });
    }
    m = text.match(/(?:remove|delete)\s+(?:the\s+)?(?:last|latest|most recent)\s+(?:entry|points?|score)\s+(?:for|from|of)\s+(.+)$/i);
    if(m){
      return withNinja(m[1], async (n, people) => {
        const mine = people.entries.filter(e => e.name && e.name.trim().toLowerCase() === n.toLowerCase())
          .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
        if(!mine.length) return `${n} has no entries.`;
        const e = mine[0];
        const when = e.createdAt ? new Date(e.createdAt).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : e.date;
        return confirmThen(`Delete **${n}**'s ${e.points}-pt entry from ${when}?`, async () => {
          await window.fbLeaderboard.deleteEntry(e.week, e.id);
          logAction(`Deleted ${e.points} pts entry for ${n}.`);
          return `🗑️ Deleted ${n}'s ${e.points}-pt entry.`;
        });
      });
    }

    // ── Points: rename ──
    m = text.match(/^rename\s+(.+?)\s+to\s+(\S+)(?:\s+(today|this week|all|everything))?\s*$/i);
    if(m){
      const from = m[1].trim(), to = m[2].trim(), scope = (m[3]||"this week").toLowerCase();
      const {entries} = await loadPeople();
      const today = window.todayStr();
      const target = window.cnNormalizeName ? window.cnNormalizeName(to) : to;
      const hits = entries.filter(e => e.name && e.name.trim().toLowerCase() === from.toLowerCase() &&
        (scope === "today" ? e.date === today : scope.startsWith("this") ? e.week === cw : true));
      if(!hits.length) return `No entries named "${from}" ${scope === "today" ? "today" : scope.startsWith("this") ? "this week" : "at all"}.`;
      return confirmThen(`Rename ${hits.length} entr${hits.length===1?"y":"ies"} from **${from}** to **${target}** (${scope})?`, async () => {
        await Promise.all(hits.map(e => db.ref(`leaderboards/week_${e.week}/entries/${e.id}`).update({name:target})));
        logAction(`Renamed ${hits.length} entries ${from} -> ${target}.`);
        return `✏️ Renamed ${hits.length} entr${hits.length===1?"y":"ies"} to ${target}.`;
      });
    }

    // ── Points: audit ──
    if(/\b(audit|check (?:the )?points|problems|issues|anything wrong|mistakes|duplicates?|regulate)\b/.test(lower)){
      const scope = /week/.test(lower) ? "week" : "today";
      const issues = await auditPoints(scope);
      if(!issues.length) return `✅ I checked ${scope === "week" ? "this week's" : "today's"} points — everything looks clean.`;
      const order = {high:0, med:1, low:2}, icon = {high:"🔴", med:"🟠", low:"🟡"};
      issues.sort((a,b)=>order[a.sev]-order[b.sev]);
      return `🔍 **${issues.length} thing${issues.length===1?"":"s"} to check** in ${scope === "week" ? "this week's" : "today's"} points:\n` +
        issues.slice(0,15).map(i => `${icon[i.sev]} ${i.text}`).join("\n") +
        (issues.length > 15 ? `\n…and ${issues.length-15} more.` : "") +
        "\nI can **rename**, **remove last entry for ...**, or **undo** to fix these.";
    }

    // ── Time actively on this site ("get back to work" kiosk reminder) ──
    let st = lower.match(/^(?:set\s+)?site\s*time\s*limit\s*(?:to\s*)?(\d+|off)\b/);
    if(st){
      if(!window.fbActiveSessions) return "This page doesn't have the site-time feature loaded.";
      const min = st[1] === "off" ? 0 : Math.min(240, parseInt(st[1],10));
      await window.fbActiveSessions.setLimit(min);
      logAction(`Site time limit set to ${min || "off"}.`);
      return min ? `⏱️ Done — the kiosk will tell a ninja to get back to work after **${min} min** actively on the site (break time doesn't count).`
                 : "⏱️ The \"get back to work\" reminder is **off**.";
    }
    if(/^(site time|who'?s on the site|who is on the site|time on (the )?site|screen time)\b/.test(lower)){
      const sessions = (await db.ref("activeSessions").once("value")).val() || {};
      const limRaw = (await db.ref("codebot/settings/siteTimeLimitMin").once("value")).val();
      const limit = limRaw === null || limRaw === undefined ? (window.CN_SITE_TIME_LIMIT_MIN||15) : Number(limRaw)||0;
      const rows = Object.entries(sessions).filter(([k,v]) => !k.startsWith("admin_") && window.cnSiteStreakMin(v) > 0)
        .map(([k,v]) => ({k, m: Math.floor(window.cnSiteStreakMin(v))})).sort((a,b)=>b.m-a.m);
      const head = `💻 **On the site right now** (limit: ${limit ? limit + " min" : "off"})`;
      if(!rows.length) return head + "\nNobody is actively on the site.";
      return head + "\n" + rows.map(r => `• ${r.k.replace(/_/g,".")} — ${r.m} min${limit && r.m >= limit ? " ⚠️ over the limit" : ""}`).join("\n") +
        "\nChange it with **site time limit 10** (or **off**).";
    }

    // ── Present ──
    if(/(who'?s here|who is here|in the dojo|checked in|present)/.test(lower)) return whoIsHere();
    if(/^(goals?|today'?s goals|who needs a goal|missing goals)\b/.test(lower)) return goalsReport();

    // ── Riddle ──
    if(/riddles? left|how many riddles/.test(lower)){
      const info = await usedRiddleInfo();
      const left = riddlesLeft(info);
      return left ? `I have **${left}** unused riddles left in my bank${left < 8 ? " — after that I'll start generating code & number riddles" : ""}.` :
        "My hand-written bank is used up, so I'm generating fresh code & number riddles now.";
    }
    m = text.match(/^set riddle[:\s]+(.+?)\s+answer[:\s]+(.+)$/i);
    if(m){
      const q = m[1].trim(), a = m[2].trim();
      return confirmThen(`Replace Week ${cw}'s riddle with:\n"${q}"\n(answer: **${a}**)? Existing submissions will be cleared.`, async () => {
        const ok = await setBotRiddle(cw, {id:"custom_"+Date.now(), q, a, alts:[]}, true);
        return ok ? `✅ Week ${cw}'s riddle is updated.` : `I couldn't update it — Week ${cw} might already be locked.`;
      });
    }
    if(/\b(new|another|different|change|replace|swap)\b.*\briddle\b/.test(lower)){
      const w = (await db.ref(`riddles/week_${cw}`).once("value")).val() || {};
      if(w.locked) return `Week ${cw} is locked, so I can't change its riddle.`;
      const riddle = pickRiddle(await usedRiddleInfo());
      if(!riddle) return "I couldn't come up with an unused riddle — try again.";
      const subs = Object.keys(w.submissions||{}).length;
      const doIt = async () => {
        const ok = await setBotRiddle(cw, riddle, true);
        return ok ? `🧩 New riddle for Week ${cw}:\n"${riddle.q}"\nAnswer: **${riddle.a}**` : "Something went wrong setting it.";
      };
      if(subs || w.text) return confirmThen(`Replace this week's riddle${subs?` (this clears ${subs} submission${subs===1?"":"s"})`:""}?`, doIt);
      return doIt();
    }
    m = text.match(/answer\s+(?:for\s+week\s*(\d+)\s+)?(?:is|=|:)\s*(.+)$/i);
    if(m && !/\?$/.test(text)) return setAnswer(m[1] ? parseInt(m[1],10) : cw, m[2].replace(/^["']|["']$/g,""));
    if(/\b(grade|finali[sz]e|close|end|lock)\b.*\b(riddle|week|now)\b|grade now/.test(lower)){
      const res = await finalizePastWeeks();
      const locked = res.filter(r => r.status === "locked");
      const needs = res.filter(r => r.status === "needs_answer");
      const parts = [];
      if(locked.length) parts.push(locked.map(resultText).join("\n\n"));
      if(needs.length) parts.push(`I still need answers for Week ${needs.map(r=>r.week).join(", ")}.`);
      if(!parts.length) parts.push(`Nothing to grade — every finished week is already locked. (Week ${cw} is still running.)`);
      return parts.join("\n\n");
    }
    if(/\b(results?|who won|winner)\b/.test(lower)){
      const wk = week || (cw - 1);
      const w = (await db.ref(`riddles/week_${wk}`).once("value")).val();
      if(!w || !w.text) return `No riddle was set for Week ${wk}.`;
      if(!w.locked) return wk >= cw ? `Week ${wk} is still running.\n` + await riddleReport(wk) : `Week ${wk} isn't graded yet — say **grade now**.`;
      return `🧩 Week ${wk}: answer **"${w.answer}"** — ${w.winner ? `🏆 winner **${w.winner}**` : "🤷 nobody got it"}.`;
    }
    if(/\b(submissions|guesses|answers so far)\b/.test(lower)) return submissionsReport(week || cw);
    if(/\briddle\b/.test(lower)) return riddleReport(week || cw);

    // ── Leaderboard ──
    if(/(leaderboard|standings|rankings?|\btop\b|who'?s winning|who is winning|who'?s leading)/.test(lower)){
      const {entries} = await loadPeople();
      return leaderboardText(entries, week || cw);
    }

    // ── Stats ──
    m = text.match(/how many points (?:does|did|has)\s+(.+?)\s+(?:have|got|get|earn)/i)
      || text.match(/how(?:'s| is| are)\s+(.+?)\s+doing/i)
      || text.match(/(?:stats|points|score|profile)\s+(?:for|of|on)?\s*(.+)$/i);
    if(m) return withNinja(m[1], (n, people) => statsFor(n, people));

    if(/\b(status|summary|overview|report|today|how'?s it going|update)\b/.test(lower)) return statusReport();

    // Last resort: maybe they just typed a ninja's name
    const people = await loadPeople();
    const guess = resolveNinja(text, people);
    if(guess.length === 1) return statsFor(guess[0], people);
    if(guess.length > 1) return choose(guess, n => statsFor(n, people));
    return null;
  }

  // -------------------------------------------------------------------------
  // Chat widget (admins only)
  // -------------------------------------------------------------------------
  const LOG_KEY = "cn_codebot_log", OPEN_KEY = "cn_codebot_open", SEEN_KEY = "cn_codebot_seen";
  function loadLog(){ try{ return JSON.parse(sessionStorage.getItem(LOG_KEY)||"[]"); }catch(e){ return []; } }
  function saveLog(log){ try{ sessionStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-80))); }catch(e){} }

  function esc(s){ return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function fmt(s){ return esc(s).replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/\n/g,"<br>"); }

  let ui = null;
  const queuedNotices = [];
  function notifyAdmin(text, key){
    try{
      const seen = JSON.parse(sessionStorage.getItem(SEEN_KEY)||"{}");
      if(key && seen[key]) return;
      if(key){ seen[key] = 1; sessionStorage.setItem(SEEN_KEY, JSON.stringify(seen)); }
    }catch(e){}
    if(ui) ui.push("bot", text, true); else queuedNotices.push(text);
  }

  function isAdminNow(){
    const s = window.cnSession && window.cnSession.getSession();
    return !!(s && s.role === "admin");
  }

  function buildWidget(){
    if(ui || !isAdminNow() || !document.body) return;
    const st = document.createElement("style");
    st.textContent = `
      .cb-fab{position:fixed;right:20px;bottom:20px;z-index:9000;width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;
        background:linear-gradient(135deg,#7c4dff,#00cfff);box-shadow:0 8px 26px rgba(124,77,255,0.5);font-size:28px;line-height:58px;color:#fff}
      .cb-fab:hover{transform:scale(1.06)} .cb-fab{transition:transform .15s}
      .cb-dot{position:absolute;top:2px;right:2px;min-width:18px;height:18px;border-radius:9px;background:#ff2d78;color:#fff;
        font:700 10px/18px 'Fira Code',monospace;padding:0 4px;box-sizing:border-box;display:none}
      .cb-panel{position:fixed;right:20px;bottom:90px;z-index:9000;width:380px;max-width:calc(100vw - 32px);height:540px;max-height:calc(100vh - 120px);
        display:none;flex-direction:column;background:rgba(10,10,18,0.98);border:1px solid rgba(124,77,255,0.45);border-radius:16px;
        box-shadow:0 20px 60px rgba(0,0,0,0.65),0 0 30px rgba(124,77,255,0.2);overflow:hidden;font-family:'Exo 2',sans-serif;color:#fff}
      .cb-panel.open{display:flex}
      .cb-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.08);background:rgba(124,77,255,0.12)}
      .cb-head b{font-family:'Orbitron',sans-serif;font-size:13px;letter-spacing:1px}
      .cb-head span{font-family:'Fira Code',monospace;font-size:9px;color:rgba(255,255,255,0.45)}
      .cb-x{margin-left:auto;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:7px;color:#fff;width:26px;height:26px;cursor:pointer}
      .cb-ai{display:flex;align-items:center;gap:8px;padding:6px 14px;border-bottom:1px solid rgba(255,255,255,0.06);font:10px 'Fira Code',monospace;color:rgba(255,255,255,0.55)}
      .cb-ai-txt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cb-ai-btn{border:1px solid rgba(124,77,255,0.5);background:rgba(124,77,255,0.15);color:#cbb8ff;border-radius:6px;padding:2px 8px;font:10px 'Fira Code',monospace;cursor:pointer}
      .cb-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
      .cb-m{max-width:88%;padding:9px 12px;border-radius:12px;font-size:12.5px;line-height:1.5;word-wrap:break-word}
      .cb-m.bot{align-self:flex-start;background:rgba(124,77,255,0.14);border:1px solid rgba(124,77,255,0.3)}
      .cb-m.me{align-self:flex-end;background:rgba(57,255,20,0.12);border:1px solid rgba(57,255,20,0.3)}
      .cb-m.typing{opacity:.6;font-style:italic}
      .cb-chips{display:flex;gap:6px;flex-wrap:wrap;padding:8px 12px 0}
      .cb-chip{border:1px solid rgba(0,207,255,0.35);background:rgba(0,207,255,0.08);color:#00cfff;border-radius:99px;padding:4px 10px;
        font:10px 'Fira Code',monospace;cursor:pointer}
      .cb-form{display:flex;gap:8px;padding:10px 12px 12px}
      .cb-in{flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.18);border-radius:10px;padding:10px 12px;color:#fff;font-size:13px;outline:none}
      .cb-in:focus{border-color:#7c4dff}
      .cb-send{border:none;border-radius:10px;padding:0 14px;cursor:pointer;background:linear-gradient(135deg,#7c4dff,#00cfff);color:#fff;font:700 11px 'Orbitron',sans-serif}
      @media (max-width:600px){ .cb-panel{right:16px;left:16px;width:auto;bottom:86px;height:70vh} .cb-fab{right:16px;bottom:16px} }
    `;
    document.head.appendChild(st);

    const fab = document.createElement("button");
    fab.className = "cb-fab"; fab.title = "CodeBot (Sensei only)"; fab.setAttribute("aria-label","Open CodeBot");
    fab.innerHTML = '🤖<span class="cb-dot"></span>';
    const panel = document.createElement("div");
    panel.className = "cb-panel"; panel.setAttribute("role","dialog"); panel.setAttribute("aria-label","CodeBot");
    panel.innerHTML = `
      <div class="cb-head"><div style="font-size:22px">🤖</div><div><b>CODEBOT</b><br><span>Sensei-only dojo assistant</span></div>
        <button class="cb-x" aria-label="Close">✕</button></div>
      <div class="cb-ai"><span class="cb-ai-txt">🧠 AI brain: off</span><button type="button" class="cb-ai-btn">Turn on</button></div>
      <div class="cb-msgs"></div>
      <div class="cb-chips"></div>
      <form class="cb-form"><input class="cb-in" placeholder="Ask or command… (try: help)" autocomplete="off"><button class="cb-send" type="submit">SEND</button></form>`;
    document.body.appendChild(panel);
    document.body.appendChild(fab);

    const msgs = panel.querySelector(".cb-msgs"), input = panel.querySelector(".cb-in"), dot = fab.querySelector(".cb-dot");
    const chips = panel.querySelector(".cb-chips");
    ["Status","Audit points","Riddle","Leaderboard","Who's here","Help"].forEach(c => {
      const b = document.createElement("button"); b.type = "button"; b.className = "cb-chip"; b.textContent = c;
      b.onclick = () => send(c); chips.appendChild(b);
    });

    let log = loadLog(), unread = 0;
    function render(){
      msgs.innerHTML = log.map(m => `<div class="cb-m ${m.from}">${fmt(m.text)}</div>`).join("");
      msgs.scrollTop = msgs.scrollHeight;
    }
    function setUnread(n){ unread = n; dot.style.display = n ? "block" : "none"; dot.textContent = n > 9 ? "9+" : String(n); }
    function isOpen(){ return panel.classList.contains("open"); }
    function setOpen(o){
      panel.classList.toggle("open", o);
      try{ sessionStorage.setItem(OPEN_KEY, o ? "1" : "0"); }catch(e){}
      if(o){ setUnread(0); render(); setTimeout(()=>input.focus(), 30); }
    }
    function push(from, text, notice){
      log.push({from, text, ts:Date.now()}); saveLog(log);
      if(isOpen()) render(); else if(notice || from === "bot") setUnread(unread + 1);
    }
    async function send(t){
      const q = String(t||"").trim(); if(!q) return;
      push("me", q);
      const typing = document.createElement("div"); typing.className = "cb-m bot typing"; typing.textContent = "thinking…";
      msgs.appendChild(typing); msgs.scrollTop = msgs.scrollHeight;
      let reply;
      try{ reply = await handleCommand(q); }
      catch(e){ console.warn(e); reply = "Something went wrong: " + (e && e.message ? e.message : e); }
      typing.remove();
      if(reply) push("bot", reply);
    }
    fab.onclick = () => setOpen(!isOpen());
    panel.querySelector(".cb-x").onclick = () => setOpen(false);
    panel.querySelector(".cb-form").onsubmit = e => { e.preventDefault(); const v = input.value; input.value = ""; send(v); };
    input.addEventListener("keydown", e => { if(e.key === "Escape") setOpen(false); });

    ui = {push};

    // AI status line
    const aiTxt = panel.querySelector(".cb-ai-txt"), aiBtn = panel.querySelector(".cb-ai-btn");
    function renderAI(){
      const AI = window.cnCodeBotAI;
      if(!AI){ aiTxt.textContent = "🧠 AI module not loaded"; aiBtn.style.display = "none"; return; }
      const s = AI.status();
      const l = s.llm, md = s.moderation;
      const modTxt = !md.enabled ? "mod: off" : md.state === "ready" ? "mod ✓" : md.state === "loading" ? `mod ${md.progress}%` : "";
      let txt;
      if(l.state === "ready") txt = `🧠 AI brain: on (${AI.modelLabel()})`;
      else if(l.state === "loading") txt = `🧠 Loading AI… ${l.progress}%`;
      else if(l.state === "error") txt = "🧠 AI brain couldn't load (say: ai status)";
      else txt = "🧠 AI brain: off";
      aiTxt.textContent = txt + (modTxt ? " · " + modTxt : "");
      aiTxt.title = l.text || "";
      aiBtn.style.display = (l.state === "ready" || l.state === "loading") ? "none" : "";
      aiBtn.textContent = l.state === "error" ? "Retry" : "Turn on";
    }
    aiBtn.onclick = () => send("turn on ai");
    renderAI();
    whenAI(AI => { AI.onChange(renderAI); renderAI(); });
    // Keep a few AI-written riddles queued while the brain is on.
    setInterval(() => { const AI = window.cnCodeBotAI; if(AI && AI.llmReady()) fillRiddleQueue(3, 6).catch(()=>{}); }, 10*60*1000);
    if(!log.length) push("bot", "Hi Sensei! I'm **CodeBot** 🤖 — I post a new riddle every week, grade it and announce the winner, and keep an eye on Points. Ask me anything or type **help**.");
    while(queuedNotices.length) push("bot", queuedNotices.shift(), true);
    render();
    if(sessionStorage.getItem(OPEN_KEY) === "1") setOpen(true);

    // Proactive heads-up about today's points (once per tab session per count).
    auditPoints("today").then(issues => {
      if(issues.length) notifyAdmin(`🔍 I spotted ${issues.length} thing${issues.length===1?"":"s"} to check in today's points. Say **audit** to see them.`, "audit_"+window.todayStr()+"_"+issues.length);
    }).catch(()=>{});
    // Tell Senseis when something gets blocked/held (and flag repeat offenders).
    db.ref("moderation/flags").limitToLast(5).on("child_added", async snap => {
      const f = snap.val();
      if(!f || !f.ts || Date.now() - f.ts > 10*60000) return;
      let repeat = "";
      if(f.accountKey){
        try{
          const recent = Object.values((await db.ref("moderation/flags").limitToLast(30).once("value")).val()||{})
            .filter(x => x.accountKey === f.accountKey && Date.now() - (x.ts||0) < 10*60000).length;
          if(recent >= 3) repeat = ` ⚠️ That's ${recent} in the last 10 minutes — consider **ban ${f.username}**.`;
        }catch(e){}
      }
      const cat = String(f.category||"inappropriate").replace("_"," ");
      const what = f.source === "poll" ? `held a poll from **${f.username||"someone"}** for review (${cat}) — it's in Polls → Pending.`
        : `blocked a chat message from **${f.username||"someone"}** (${cat}).`;
      notifyAdmin(`🛡️ I ${what}${repeat}`, "flag_"+snap.key);
    });
    // Surface new weekly announcements made by any tab.
    db.ref("codebot/announcements").limitToLast(1).on("child_added", snap => {
      const a = snap.val();
      if(a && a.ts && Date.now() - a.ts < 7*24*3600000) notifyAdmin(a.text, "ann_"+snap.key);
    });
  }

  // -------------------------------------------------------------------------
  // Public API + boot
  // -------------------------------------------------------------------------
  window.cnCodeBot = {answerMatches, runWeekly, presentNinjas, handleCommand, finalizeWeek, ensureCurrentRiddle, auditPoints,
    moderate, moderatePoll, moderateAsync, moderatePollAsync, logModeration, reviewPoll, fillRiddleQueue,
    _attachAI: api => attachAI(api)};

  function boot(){
    buildWidget();
    try{ startModerationSweeps(); }catch(e){ console.warn("CodeBot moderation sweep failed to start:", e); }
    setTimeout(runWeekly, 1500);
    setInterval(runWeekly, 5*60*1000);
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
