/* ==========================================================================
   Code Ninjas – Robbinsville : shared.js
   Shared across every page: Firebase setup, date/week helpers, the Points
   (formerly "Ring Toss") data layer, break-time helpers, and the session /
   login system (single-login enforcement + 2-hour Points-based access +
   automatic sign-out when the tab is closed).
   ========================================================================== */
(function(){
  const firebaseConfig = {
    apiKey:"AIzaSyBaZLr1zIzGPYhl6e7Gqy0dI3o6ZuyvP4s",
    authDomain:"githubpat-2d39d.firebaseapp.com",
    projectId:"githubpat-2d39d",
    storageBucket:"githubpat-2d39d.firebasestorage.app",
    messagingSenderId:"375553339098",
    appId:"1:375553339098:web:729bb04215f50217937fe3",
    databaseURL:"https://githubpat-2d39d-default-rtdb.firebaseio.com"
  };
  firebase.initializeApp(firebaseConfig);
  const db = firebase.database();
  window.cnDb = db;

  // Shared Sensei password (kept from the original app).
  window.CN_ADMIN_PASS = "Senseis";

  // -------------------------------------------------------------------------
  // Date / week helpers (used by every tab)
  // -------------------------------------------------------------------------
  const WEEK_START = new Date("2026-05-14T00:00:00");
  window.getCurrentWeek = function(){
    const diff = new Date() - WEEK_START;
    return diff < 0 ? 1 : Math.floor(diff/(7*24*60*60*1000))+1;
  };
  window.getWeekLabel = function(n){
    const s = new Date(WEEK_START.getTime()+(n-1)*7*24*60*60*1000);
    const e = new Date(s.getTime()+6*24*60*60*1000);
    const fmt = d => d.toLocaleDateString("en-US",{month:"short",day:"numeric"});
    return `Week ${n} (${fmt(s)} – ${fmt(e)})`;
  };
  window.todayStr = function(){
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };

  // Turns a name/username like "adam.dodo" into a Firebase-safe key
  // (Realtime Database keys can't contain '.', '#', '$', '[', ']').
  window.cnKeySafe = function(str){
    return String(str).trim().toLowerCase().replace(/[.#$\[\]]/g,"_");
  };

  // -------------------------------------------------------------------------
  // Points (formerly "Ring Toss") data layer
  // -------------------------------------------------------------------------
  window.fbLeaderboard = {
    async getAll(){
      const snap = await db.ref("leaderboards").once("value");
      const val = snap.val() || {};
      const all = [];
      for(const weekKey of Object.keys(val)){
        const week = parseInt(weekKey.replace("week_",""));
        const entries = val[weekKey].entries || {};
        for(const [id,entry] of Object.entries(entries)){
          all.push({id,week,...entry});
        }
      }
      return all;
    },
    // createdAt is a real timestamp — it's what powers the "only logged in
    // within the last 2 hours" login window and the live In The Dojo view.
    async addEntry(week,name,points,date){
      const ref = db.ref(`leaderboards/week_${week}/entries`).push();
      await ref.set({week,name,points,date,createdAt:Date.now()});
      return {id:ref.key};
    },
    async deleteEntry(week,entryId){
      await db.ref(`leaderboards/week_${week}/entries/${entryId}`).remove();
    }
  };

  // Registered usernames — kept only so "In The Dojo" can cross-reference a
  // Points first-name to a fuller registered account for display purposes.
  window.fbUsernames = {
    async getAll(){
      const snap = await db.ref("usernames").once("value");
      const val = snap.val() || {};
      const list = [];
      for(const [key,storedVal] of Object.entries(val)){
        if(typeof storedVal === "string") list.push(storedVal);
        else if(typeof key === "string" && key.includes(".")) list.push(key);
      }
      return [...new Set(list)];
    }
  };

  // -------------------------------------------------------------------------
  // Sample / demo data — shown to Guests instead of real student data.
  // Guests must never see actual ninja names, points, chat, or session info.
  // -------------------------------------------------------------------------
  window.cnSampleData = function(){
    const week = window.getCurrentWeek();
    const today = window.todayStr();
    const now = Date.now();
    const monthKey = new Date().toISOString().slice(0,7);
    return {
      leaderboard: [
        {id:"sample_1",week,name:"Alex",points:150,date:today,createdAt:now-60*60*1000},
        {id:"sample_2",week,name:"Jordan",points:120,date:today,createdAt:now-90*60*1000},
        {id:"sample_3",week,name:"Sam",points:95,date:today,createdAt:now-120*60*1000},
        {id:"sample_4",week,name:"Alex",points:80,date:today,createdAt:now-150*60*1000},
      ],
      usernames: ["alex.sample","jordan.sample","sam.sample"],
      notm: [
        {id:"sample_notm_1",monthKey,name:"Alex",points:480},
        {id:"sample_notm_2",monthKey,name:"Jordan",points:410},
        {id:"sample_notm_3",monthKey,name:"Sam",points:365},
      ],
      polls: [
        {id:"sample_poll_1",title:"Favorite thing to build in Code Ninjas?",creator:"Sensei",status:"approved",archived:false,createdAt:now-24*60*60*1000,
          options:[{text:"A game"},{text:"A website"},{text:"An app"}],
          votes:{sample_voter_1:0,sample_voter_2:0,sample_voter_3:1}},
      ],
      riddles: {
        ["week_"+week]: {
          text:"Sample riddle: I speak without a mouth and hear without ears. I have no body, but come alive with the wind. What am I?",
          answer:"", winner:null,
          submissions:{sample_sub_1:{name:"Alex",answer:"An echo",ts:now-10*60*1000}}
        }
      },
      breakStatuses:{},
      nitdPresent:[
        {name:"Alex",attempts:1,points:150,lastSeen:now-30*60*1000},
        {name:"Jordan",attempts:2,points:120,lastSeen:now-45*60*1000},
      ],
      chat: [
        {id:"sample_chat_1",senderName:"Alex",role:"student",text:"Hi everyone! Excited for class today 🥷",ts:now-45*60*1000},
        {id:"sample_chat_2",senderName:"Sensei",role:"admin",text:"Welcome ninjas! Remember to be kind in chat.",ts:now-40*60*1000},
        {id:"sample_chat_3",senderName:"Jordan",role:"student",text:"Anyone else working on the maze game?",ts:now-30*60*1000},
      ],
      games: [
        {name:"Alex",score:4200},
        {name:"Sam",score:3100},
        {name:"Jordan",score:2800},
      ]
    };
  };

  // -------------------------------------------------------------------------
  // Per-student break flags (set from "In The Dojo", used by Games)
  // -------------------------------------------------------------------------
  window.BREAK_DURATION_MS = 10*60*1000; // 10 minutes
  window.cnIsBreakActive = function(entry){
    return !!(entry && entry.startedAt && (Date.now()-entry.startedAt < window.BREAK_DURATION_MS));
  };
  window.fbBreak = {
    async getAll(){
      const snap = await db.ref("games/onBreak").once("value");
      return snap.val() || {};
    },
    async setBreak(usernameKey, on){
      if(on){ await db.ref(`games/onBreak/${usernameKey}`).set({startedAt: Date.now()}); }
      else{ await db.ref(`games/onBreak/${usernameKey}`).remove(); }
    }
  };

  // -------------------------------------------------------------------------
  // Ninja Chat moderation — bad-word list lives in Firebase (pushed in by the
  // Sensei/admin directly) at "moderation/badWords", so it can be updated
  // without a code change. A small built-in fallback list is used until the
  // Firebase list loads (or if it's ever empty).
  // -------------------------------------------------------------------------
  const CN_FALLBACK_BAD_WORDS = [
    "fuck","shit","bitch","asshole","dumbass","bastard","dick","piss","slut","whore",
    "nigger","nigga","fag","faggot","retard","retarded","cunt","cock","pussy",
    "kill yourself","kys","rape","sex","porn","nude","naked",
    "hell","damn","crap","idiot","stupid","dumb","shut up","loser","ugly","hate you"
  ];
  window._cnBadWordsCache = CN_FALLBACK_BAD_WORDS.slice();

  window.fbModeration = {
    async loadBadWords(){
      try{
        const snap = await db.ref("moderation/badWords").once("value");
        const val = snap.val();
        let list = null;
        if(Array.isArray(val)) list = val.filter(Boolean);
        else if(val && typeof val === "object") list = Object.values(val).filter(Boolean);
        if(list && list.length) window._cnBadWordsCache = list.map(w=>String(w).toLowerCase());
      }catch(e){ /* keep fallback list */ }
      return window._cnBadWordsCache;
    },
    // Records a flagged message and immediately bans the account key so the
    // student is signed out and can't log back in until a Sensei unbans them.
    async flagAndBan(username, accountKey, text){
      const flagRef = db.ref("moderation/flags").push();
      await flagRef.set({username: username||"", accountKey: accountKey||"", text: text||"", ts: Date.now(), status:"banned"});
      if(accountKey){
        await db.ref(`moderation/bans/${accountKey}`).set({banned:true, flagId:flagRef.key, ts:Date.now()});
      }
      return flagRef.key;
    },
    async setBan(accountKey, banned, flagId){
      if(!accountKey) return;
      if(banned){ await db.ref(`moderation/bans/${accountKey}`).set({banned:true, flagId:flagId||null, ts:Date.now()}); }
      else{ await db.ref(`moderation/bans/${accountKey}`).remove(); }
      if(flagId){ await db.ref(`moderation/flags/${flagId}`).update({status: banned?"banned":"unbanned"}); }
    },
    async isBanned(accountKey){
      if(!accountKey) return false;
      try{
        const snap = await db.ref(`moderation/bans/${accountKey}`).once("value");
        const v = snap.val();
        return !!(v && v.banned);
      }catch(e){ return false; }
    },
    listenFlags(callback){
      const ref = db.ref("moderation/flags").limitToLast(200);
      const handler = snap=>{
        const val = snap.val()||{};
        const list = Object.entries(val).map(([id,f])=>({id,...f})).sort((a,b)=>(b.ts||0)-(a.ts||0));
        callback(list);
      };
      ref.on("value",handler);
      return ()=>ref.off("value",handler);
    }
  };
  // Kick off a load right away so the freshest list is ready before anyone types.
  window.fbModeration.loadBadWords();

  // -------------------------------------------------------------------------
  // Shared navigation
  // -------------------------------------------------------------------------
  window.CN_NAV = [
    {id:"home",icon:"🏠",label:"Home",href:"home.html"},
    {id:"leaderboards",icon:"🏆",label:"Points",href:"entrygames.html"},
    {id:"riddle",icon:"🧩",label:"Riddle",href:"riddle.html"},
    {id:"notm",icon:"⭐",label:"NOTM",href:"notm.html"},
    {id:"polls",icon:"📊",label:"Polls",href:"polls.html"},
    {id:"nitd",icon:"📍",label:"In The Dojo",href:"nitd.html"},
    {id:"games",icon:"🎮",label:"Games",href:"games.html"},
    {id:"chat",icon:"💬",label:"Ninja Chat",href:"chat.html"},
    {id:"tutorial",icon:"📘",label:"Tutorial",href:"tutorial.html"},
  ];

  // -------------------------------------------------------------------------
  // Session handling
  //  - sessionStorage (not localStorage) means closing the tab signs you out.
  //  - Only ninjas with a Points entry logged TODAY, within the last 2 hours,
  //    may log in as a student — otherwise the login is rejected.
  //  - Firebase "activeSessions/<account>" enforces a single login per
  //    account (admin or a given ninja) at a time.
  // -------------------------------------------------------------------------
  window.SESSION_HOURS = 2;
  window.SESSION_MS = window.SESSION_HOURS*60*60*1000;
  const HEARTBEAT_MS = 20*1000; // how often an open tab "checks in"
  const STALE_MS = 45*1000;     // how long before a dead session can be taken over

  function randId(){ return "sess_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2); }

  window.cnSession = {
    _heartbeatTimer: null,

    getSession(){
      const role = sessionStorage.getItem("cn_role");
      if(!role) return null;
      return {
        role,
        username: sessionStorage.getItem("cn_username") || null,
        sessionId: sessionStorage.getItem("cn_session_id") || null,
        accountKey: sessionStorage.getItem("cn_account_key") || null,
        expiresAt: Number(sessionStorage.getItem("cn_session_expires") || 0) || null,
      };
    },

    isExpired(session){
      session = session || this.getSession();
      if(!session || session.role !== "student") return false;
      if(!session.expiresAt) return false;
      return Date.now() > session.expiresAt;
    },

    // Looks for a Points entry for `name` dated today, and checks it was
    // logged within the last SESSION_HOURS. This is the gate for student login.
    async findActivePointsEntry(loginName){
      const trimmed = String(loginName || "").trim();
      if(!trimmed) return {ok:false, reason:"empty"};
      // Points entries are saved under first name only (e.g. "Nathan"),
      // but students log in with their full username (e.g. "nathan.blah").
      // Match on the first-name portion of whatever was typed at login.
      const firstName = trimmed.split(".")[0].trim().toLowerCase();
      const today = window.todayStr();
      let all = [];
      try{ all = await window.fbLeaderboard.getAll(); }
      catch(e){ return {ok:false, reason:"error"}; }
      const matches = all.filter(e => e.date === today && e.name && e.name.trim().toLowerCase() === firstName);
      if(matches.length === 0) return {ok:false, reason:"not_entered"};
      const mostRecent = matches.reduce((m,e)=>Math.max(m, e.createdAt || 0), 0);
      if(!mostRecent) return {ok:false, reason:"not_entered"};
      if(Date.now() - mostRecent > window.SESSION_MS) return {ok:false, reason:"expired"};
      // Keep the full login name (e.g. "nathan.blah") as the matched identity,
      // not just the first name, so accountKey/session/display stay correct.
      return {ok:true, matchedName: trimmed, enteredAt: mostRecent, expiresAt: mostRecent + window.SESSION_MS};
    },

    // Claims a single-login "slot" for an account (admin, or a given ninja).
    // Returns {ok:false} if someone else already holds an active slot.
    async claimAccount(accountKey){
      const ref = db.ref(`activeSessions/${accountKey}`);
      const snap = await ref.once("value");
      const active = snap.val();
      if(active && active.lastSeen && (Date.now() - active.lastSeen < STALE_MS)){
        return {ok:false};
      }
      const sessionId = randId();
      await ref.set({sessionId, lastSeen: Date.now()});
      try{ ref.onDisconnect().set({sessionId, lastSeen: 0}); }catch(e){}
      return {ok:true, sessionId};
    },

    // Admins may have as many simultaneous sessions/devices as they like —
    // each login gets its own unique slot, so Senseis never lock each other out.
    async loginAdmin(){
      const sessionId = randId();
      const accountKey = "admin_"+sessionId;
      const ref = db.ref(`activeSessions/${accountKey}`);
      await ref.set({sessionId, lastSeen: Date.now(), role:"admin"});
      try{ ref.onDisconnect().remove(); }catch(e){}
      sessionStorage.setItem("cn_role","admin");
      sessionStorage.removeItem("cn_username");
      sessionStorage.setItem("cn_session_id", sessionId);
      sessionStorage.setItem("cn_account_key", accountKey);
      sessionStorage.removeItem("cn_session_expires");
      this.startHeartbeat(accountKey);
      return {ok:true};
    },

    async loginStudent(name){
      const found = await this.findActivePointsEntry(name);
      if(!found.ok) return found;
      const accountKey = window.cnKeySafe(found.matchedName);
      const banned = await window.fbModeration.isBanned(accountKey);
      if(banned) return {ok:false, reason:"banned"};
      const claim = await this.claimAccount(accountKey);
      if(!claim.ok) return {ok:false, reason:"already_logged_in"};
      sessionStorage.setItem("cn_role","student");
      sessionStorage.setItem("cn_username", found.matchedName);
      sessionStorage.setItem("cn_session_id", claim.sessionId);
      sessionStorage.setItem("cn_account_key", accountKey);
      sessionStorage.setItem("cn_session_expires", String(found.expiresAt));
      this.startHeartbeat(accountKey);
      return {ok:true};
    },

    async loginGuest(){
      this.stopHeartbeat();
      sessionStorage.setItem("cn_role","guest");
      sessionStorage.removeItem("cn_username");
      sessionStorage.removeItem("cn_session_id");
      sessionStorage.removeItem("cn_account_key");
      sessionStorage.removeItem("cn_session_expires");
      return {ok:true};
    },

    startHeartbeat(accountKey){
      this.stopHeartbeat();
      if(!accountKey) return;
      const ref = db.ref(`activeSessions/${accountKey}`);
      const sessionId = sessionStorage.getItem("cn_session_id");
      this._heartbeatTimer = setInterval(()=>{
        ref.once("value").then(snap=>{
          const v = snap.val();
          if(v && v.sessionId === sessionId){ ref.update({lastSeen: Date.now()}); }
        }).catch(()=>{});
      }, HEARTBEAT_MS);
    },
    stopHeartbeat(){
      if(this._heartbeatTimer){ clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    },
    // Re-starts the heartbeat after navigating to a new page in the same tab.
    resumeHeartbeat(){
      const session = this.getSession();
      if(!session || session.role === "guest") return;
      const accountKey = session.accountKey || (session.role === "admin" ? "admin" : (session.username ? window.cnKeySafe(session.username) : null));
      if(accountKey) this.startHeartbeat(accountKey);
    },

    async logout(reason){
      this.stopHeartbeat();
      const accountKey = sessionStorage.getItem("cn_account_key");
      if(accountKey){
        try{ await db.ref(`activeSessions/${accountKey}`).remove(); }catch(e){}
      }
      sessionStorage.clear();
      window.location.href = "index.html" + (reason ? ("?reason="+reason) : "");
    }
  };

  // React hook (React is already loaded globally by the time this file runs)
  // used by every logged-in page to bootstrap + continuously guard the session.
  window.useCnAuth = function(){
    const [auth, setAuth] = React.useState(null);
    const [ready, setReady] = React.useState(false);
    React.useEffect(()=>{
      const session = window.cnSession.getSession();
      if(!session){ window.location.href = "index.html"; return; }
      if(window.cnSession.isExpired(session)){ window.cnSession.logout("expired"); return; }
      window.cnSession.resumeHeartbeat();
      setAuth({role:session.role, username:session.username, accountKey:session.accountKey});
      setReady(true);
    },[]);
    React.useEffect(()=>{
      const iv = setInterval(async ()=>{
        const s = window.cnSession.getSession();
        if(!s){ window.location.href = "index.html"; return; }
        if(window.cnSession.isExpired(s)){ window.cnSession.logout("expired"); return; }
        if(s.role === "student" && s.accountKey){
          try{
            const banned = await window.fbModeration.isBanned(s.accountKey);
            if(banned){ window.cnSession.logout("inappropriate"); return; }
          }catch(e){}
        }
      }, 20000);
      return ()=>clearInterval(iv);
    },[]);
    return {auth, ready};
  };

  // -------------------------------------------------------------------------
  // Ninja Chat profanity filter — blocks obviously inappropriate language
  // client-side before a message is ever sent/stored. Not a substitute for
  // adult supervision, but stops the common cases.
  // -------------------------------------------------------------------------
  window.cnContainsBadWords = function(text){
    const norm = " " + String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g," ") + " ";
    const list = window._cnBadWordsCache || [];
    return list.some(w => w && (norm.includes(" "+w+" ") || norm.includes(w)));
  };

  // -------------------------------------------------------------------------
  // Guided walkthrough — a real, cross-page product tour. Each step targets
  // a nav item (via data-tour-nav="<id>" on the actual sidebar/mobile button)
  // and points an arrow-style callout at it, with role-specific copy:
  //   ninja  -> only what a ninja themselves can do on that tab
  //   admin  -> the Sensei controls (a superset of the ninja view)
  //   guest  -> every tab is covered, same as admin, but notes that guests
  //             are seeing sample data instead of real students
  // Advancing a step navigates the browser to that tab's page; state is kept
  // in sessionStorage so it survives the page load.
  // -------------------------------------------------------------------------
  window.CN_TOUR_TABS = ["home","leaderboards","riddle","notm","polls","nitd","games","chat"];
  window.CN_TOUR_CONTENT = {
    home:{title:"Home",
      ninja:"This is your dashboard — a quick snapshot of this week's competition, like the top ninja and how many points have been logged today.",
      admin:"This is the dashboard — a live snapshot of this week's competition across every ninja. Use it to see activity at a glance before diving into a tab.",
      guest:"This is the dashboard. As a guest you're seeing sample numbers here — real ninjas and their points are only visible to signed-in accounts."},
    leaderboards:{title:"Points",
      ninja:"See the weekly leaderboard, ranked by the points your Sensei logs for you each day.",
      admin:"This is where you log each ninja's daily score with \"+ Add Entry.\" It's also what unlocks that ninja's 2-hour login window for the day.",
      guest:"The real Points page shows every ninja's daily score. You're seeing a sample leaderboard here instead of actual students."},
    riddle:{title:"Riddle",
      ninja:"Submit your best guess for the weekly riddle. Your Sensei locks in a winner once the week ends — sometimes nobody gets it, and that's okay!",
      admin:"Set the weekly riddle and answer, review every ninja's submissions, and lock in a winner — or choose \"No One\" if nobody solved it.",
      guest:"This tab shows the weekly riddle, and lets signed-in ninjas submit guesses. You're viewing a sample riddle and sample guess here."},
    notm:{title:"Ninja of the Month",
      ninja:"A monthly hall of fame — see the top-scoring ninja each month, plus the all-time \"best month ever\" leaderboard.",
      admin:"Add or remove monthly point totals per ninja here. The highest score each month wins, and the Hall of Fame tracks the best month ever.",
      guest:"Sample standings only — the real page ranks actual ninjas by their monthly point totals."},
    polls:{title:"Polls",
      ninja:"Vote in polls your Sensei creates — your voice helps decide dojo activities, game nights, and more.",
      admin:"Create new polls, watch votes roll in live, and archive or delete old ones once they're no longer needed.",
      guest:"You can see poll results here, but voting is only available to signed-in ninjas. This is a sample poll."},
    nitd:{title:"In The Dojo",
      ninja:"See which ninjas are currently checked in — a live view of who's in the dojo right now.",
      admin:"See every ninja currently within their 2-hour window, and start or end their break time — that's what unlocks Games for them.",
      guest:"This normally shows which real ninjas are checked in right now — you're seeing sample check-ins instead of actual students."},
    games:{title:"Games",
      ninja:"Games unlock only when your Sensei starts your break from \"In The Dojo.\" Play Memory Match or Dino Runner until your break ends!",
      admin:"Ninjas can play here once you start their break from \"In The Dojo.\" You can also see the games leaderboards.",
      guest:"Games are only playable by signed-in ninjas during break time — the scores shown to you here are sample data."},
    chat:{title:"Ninja Chat",
      ninja:"Chat with other ninjas in a friendly, moderated space. Inappropriate language is automatically blocked.",
      admin:"Ninjas chat here. Hover a message and click \"✕ delete\" to remove anything inappropriate — you're always the final backstop.",
      guest:"Guests can read chat but can't send messages, and you're seeing sample messages here instead of the real conversation."},
  };

  window.cnTour = {
    start(role){
      sessionStorage.setItem("cn_tour_active","1");
      sessionStorage.setItem("cn_tour_role", role);
      sessionStorage.setItem("cn_tour_step","0");
      const first = window.CN_NAV.find(n=>n.id===window.CN_TOUR_TABS[0]);
      window.location.href = first.href;
    },
    isActive(){ return sessionStorage.getItem("cn_tour_active")==="1"; },
    exit(){
      sessionStorage.removeItem("cn_tour_active");
      sessionStorage.removeItem("cn_tour_role");
      sessionStorage.removeItem("cn_tour_step");
    }
  };

  // Plain React.createElement component (no JSX/Babel needed) so every page
  // can mount the exact same overlay by just rendering <TourOverlay/>.
  window.CnTourOverlay = function CnTourOverlay(){
    const h = React.createElement;
    const [state, setState] = React.useState(null); // {idx, tabId, title, text, rect}
    const [tick, setTick] = React.useState(0);

    function currentPageFile(){
      const path = window.location.pathname.split("/").pop();
      return path || "home.html";
    }

    function findTarget(){
      const isMobileNow = window.innerWidth <= 768;
      if(isMobileNow){
        return document.querySelector('[data-tour-mobile-anchor]');
      }
      const idx = Number(sessionStorage.getItem("cn_tour_step")||0);
      const tabId = window.CN_TOUR_TABS[idx];
      return document.querySelector('[data-tour-nav="'+tabId+'"]');
    }

    function refresh(){
      if(!window.cnTour.isActive()){ setState(null); return; }
      const idx = Number(sessionStorage.getItem("cn_tour_step")||0);
      const tabId = window.CN_TOUR_TABS[idx];
      if(!tabId){ window.cnTour.exit(); setState(null); return; }
      const navItem = window.CN_NAV.find(n=>n.id===tabId);
      const curPage = currentPageFile();
      if(navItem.href !== curPage){ setState(null); return; } // waiting for navigation
      const role = sessionStorage.getItem("cn_tour_role") || "ninja";
      const content = window.CN_TOUR_CONTENT[tabId];
      const el = findTarget();
      const rect = el ? el.getBoundingClientRect() : null;
      setState({idx, total:window.CN_TOUR_TABS.length, tabId,
        title: content.title, text: content[role] || content.ninja, rect,
        mobile: window.innerWidth <= 768});
    }

    React.useEffect(()=>{
      refresh();
      const onResize = ()=>refresh();
      window.addEventListener("resize", onResize);
      window.addEventListener("scroll", onResize, true);
      // Elements can mount slightly after first paint; a couple of retries
      // covers that without needing a MutationObserver.
      const t1=setTimeout(refresh,150), t2=setTimeout(refresh,500);
      return ()=>{ window.removeEventListener("resize", onResize); window.removeEventListener("scroll", onResize, true); clearTimeout(t1); clearTimeout(t2); };
    },[tick]);

    function goTo(idx){
      if(idx < 0){ return; }
      if(idx >= window.CN_TOUR_TABS.length){ window.cnTour.exit(); window.location.href="home.html"; return; }
      sessionStorage.setItem("cn_tour_step", String(idx));
      const tabId = window.CN_TOUR_TABS[idx];
      const navItem = window.CN_NAV.find(n=>n.id===tabId);
      if(navItem.href !== currentPageFile()){ window.location.href = navItem.href; }
      else{ setTick(t=>t+1); }
    }

    if(!state) return null;
    const r = state.rect;
    const roleColor = "#39ff14";

    // Spotlight ring around the target element (fixed-position box with a
    // glow border) plus a dim backdrop everywhere else.
    const spotlight = r ? h("div",{style:{
      position:"fixed", left:r.left-6, top:r.top-6, width:r.width+12, height:r.height+12,
      borderRadius:12, border:`2px solid ${roleColor}`, boxShadow:`0 0 0 4000px rgba(0,0,0,0.55), 0 0 18px ${roleColor}aa`,
      zIndex:301, pointerEvents:"none", transition:"all .25s ease"
    }}) : h("div",{style:{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:301,pointerEvents:"none"}});

    // Tooltip card: to the right of the sidebar item on desktop, or a bottom
    // sheet on mobile where we don't have a precise per-item target.
    let cardStyle;
    if(state.mobile || !r){
      cardStyle = {position:"fixed", left:16, right:16, bottom:16, zIndex:302};
    } else {
      const top = Math.min(Math.max(r.top-10,16), window.innerHeight-260);
      cardStyle = {position:"fixed", left:r.right+18, top, width:300, zIndex:302};
    }

    const card = h("div",{style:{...cardStyle,
        background:"rgba(10,10,16,0.97)", border:`1px solid ${roleColor}55`, borderRadius:14,
        padding:"18px 18px 14px", boxShadow:`0 8px 32px rgba(0,0,0,0.5), 0 0 24px ${roleColor}22`,
        fontFamily:"'Exo 2',sans-serif"}},
      (!state.mobile && r) ? h("div",{style:{position:"absolute", left:-9, top:Math.min(24, r.height/2+1),
        width:16,height:16, background:"rgba(10,10,16,0.97)", borderLeft:`1px solid ${roleColor}55`,
        borderBottom:`1px solid ${roleColor}55`, transform:"rotate(45deg)"}}) : null,
      h("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}},
        h("span",{style:{fontFamily:"'Fira Code',monospace",fontSize:9,color:roleColor,letterSpacing:1.5}},
          "STEP "+(state.idx+1)+" OF "+state.total),
        h("button",{onClick:()=>{window.cnTour.exit(); setState(null);},
          style:{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:7,
            color:"rgba(255,255,255,0.6)",width:22,height:22,cursor:"pointer",fontSize:11,lineHeight:1}}, "✕")),
      h("h4",{style:{fontFamily:"'Orbitron',sans-serif",fontSize:14,color:"#fff",marginBottom:6}}, state.title),
      h("p",{style:{fontSize:12.5,color:"rgba(255,255,255,0.65)",lineHeight:1.55,marginBottom:14}}, state.text),
      h("div",{style:{display:"flex",gap:8}},
        h("button",{onClick:()=>goTo(state.idx-1), disabled:state.idx===0, style:{flex:1,padding:"9px",borderRadius:9,
          border:"1px solid rgba(255,255,255,0.15)", background:"rgba(255,255,255,0.05)",
          color:state.idx===0?"rgba(255,255,255,0.2)":"rgba(255,255,255,0.7)",
          cursor:state.idx===0?"not-allowed":"pointer", fontFamily:"'Fira Code',monospace",fontSize:10,letterSpacing:1}}, "← BACK"),
        h("button",{onClick:()=>goTo(state.idx+1), style:{flex:1,padding:"9px",borderRadius:9,border:"none",
          background:`linear-gradient(135deg,${roleColor},#00cfff)`, color:"#000", cursor:"pointer",
          fontFamily:"'Orbitron',sans-serif",fontWeight:700,fontSize:10,letterSpacing:1}},
          state.idx===state.total-1 ? "FINISH ✓" : "NEXT →"))
    );

    return h(React.Fragment, null, spotlight, card);
  };
})();
