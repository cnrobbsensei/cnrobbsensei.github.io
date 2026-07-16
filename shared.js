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

    async loginAdmin(){
      const claim = await this.claimAccount("admin");
      if(!claim.ok) return {ok:false, reason:"already_logged_in"};
      sessionStorage.setItem("cn_role","admin");
      sessionStorage.removeItem("cn_username");
      sessionStorage.setItem("cn_session_id", claim.sessionId);
      sessionStorage.setItem("cn_account_key","admin");
      sessionStorage.removeItem("cn_session_expires");
      this.startHeartbeat("admin");
      return {ok:true};
    },

    async loginStudent(name){
      const found = await this.findActivePointsEntry(name);
      if(!found.ok) return found;
      const accountKey = window.cnKeySafe(found.matchedName);
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
      setAuth({role:session.role, username:session.username});
      setReady(true);
    },[]);
    React.useEffect(()=>{
      const iv = setInterval(()=>{
        const s = window.cnSession.getSession();
        if(!s){ window.location.href = "index.html"; return; }
        if(window.cnSession.isExpired(s)){ window.cnSession.logout("expired"); }
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
  const CN_BAD_WORDS = [
    "fuck","shit","bitch","asshole","dumbass","bastard","dick","piss","slut","whore",
    "nigger","nigga","fag","faggot","retard","retarded","cunt","cock","pussy",
    "kill yourself","kys","suicide","rape","sex","porn","nude","naked",
    "hell","damn","crap","idiot","stupid","dumb","shut up","loser","ugly","hate you"
  ];
  window.cnContainsBadWords = function(text){
    const norm = " " + String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g," ") + " ";
    return CN_BAD_WORDS.some(w => norm.includes(" "+w+" ") || norm.includes(w));
  };
})();
