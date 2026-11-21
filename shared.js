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

  // Normalizes a typed name to one canonical casing (e.g. "JOHN", "john",
  // "JoHn" all become "John") so the same ninja never gets split into
  // separate leaderboard rows just because someone typed the name differently.
  window.cnNormalizeName = function(str){
    const trimmed = String(str||"").trim().replace(/\s+/g," ");
    if(!trimmed) return trimmed;
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
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
    async addEntry(week,name,points,date,sessionHours){
      const ref = db.ref(`leaderboards/week_${week}/entries`).push();
      const cleanHours = window.cnCleanHours(sessionHours);
      await ref.set({week,name,points,date,sessionHours:cleanHours,createdAt:Date.now()});
      return {id:ref.key};
    },
    async deleteEntry(week,entryId){
      await db.ref(`leaderboards/week_${week}/entries/${entryId}`).remove();
    },
    // Realtime listener — fires immediately whenever any entry changes.
    listen(callback){
      const ref = db.ref("leaderboards");
      const handler = () => { window.fbLeaderboard.getAll().then(callback).catch(()=>{}); };
      ref.on("value", handler);
      return () => ref.off("value", handler);
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
    },
    // Realtime listener — fires immediately whenever the username list changes.
    listen(callback){
      const ref = db.ref("usernames");
      const handler = () => { window.fbUsernames.getAll().then(callback).catch(()=>{}); };
      ref.on("value", handler);
      return () => ref.off("value", handler);
    }
  };

  // -------------------------------------------------------------------------
  // Ninja Profiles — per-account avatar (from a fixed emoji set, never free
  // text, so nothing arbitrary ever gets stored/rendered) plus a link to
  // profile.html. Achievements themselves are computed on the fly from
  // existing data (Points/NOTM/Riddle/Games) rather than stored here.
  // -------------------------------------------------------------------------
  window.CN_AVATARS = ["🥷","🐉","🦊","🐯","🦁","🐺","🦅","🐢","🦈","🐧","🤖","👾","🎮","⚡","🔥","🌟","💎","🚀","🎯","🛡️"];

  // Mirrors games.html's GAMES_LIST/GAME_META (id -> leaderboard id), kept
  // here too so profile.html can compute game achievements without needing
  // to load/duplicate all of games.html's game logic.
  window.CN_GAMES_LIST = [
    {id:"memory",name:"Memory Match",icon:"🧠",leaderboardId:"memoryMatch"},
    {id:"dino",name:"Dino Runner",icon:"🦖",leaderboardId:"dino"},
    {id:"snake",name:"Snake",icon:"🐍",leaderboardId:"snake"},
    {id:"minesweeper",name:"Minesweeper",icon:"💣",leaderboardId:"minesweeper"},
    {id:"flappy",name:"Flappy Ninja",icon:"🥷",leaderboardId:"flappy"},
    {id:"game2048",name:"2048",icon:"🔢",leaderboardId:"game2048"},
    {id:"whack",name:"Whack-a-Ninja",icon:"🥷",leaderboardId:"whack"},
    {id:"breakout",name:"Brick Breaker",icon:"🧱",leaderboardId:"breakout"},
    {id:"lanerush",name:"Lane Rush 3D",icon:"🛣️",leaderboardId:"lanerush"},
  ];

  window.fbProfiles = {
    async getAll(){
      const snap = await db.ref("profiles").once("value");
      return snap.val() || {};
    },
    async get(accountKey){
      if(!accountKey) return null;
      const snap = await db.ref(`profiles/${accountKey}`).once("value");
      return snap.val() || null;
    },
    async setAvatar(accountKey, avatar){
      if(!accountKey) return;
      // Only ever accept one of the fixed emoji options — never arbitrary text.
      const clean = window.CN_AVATARS.includes(avatar) ? avatar : window.CN_AVATARS[0];
      await db.ref(`profiles/${accountKey}`).update({avatar: clean, updatedAt: Date.now()});
    },
    listen(callback){
      const ref = db.ref("profiles");
      const handler = snap => callback(snap.val() || {});
      ref.on("value", handler);
      return () => ref.off("value", handler);
    }
  };

  // Guests must never reach a profile (their own or anyone else's).
  window.cnCanViewProfiles = function(role){ return role === "student" || role === "admin"; };

  // Builds the href for a given ninja's profile page. `nameOrKey` can be a
  // first name (from a Points entry) or a full registered username.
  window.cnProfileHref = function(nameOrKey){
    return "profile.html?u=" + encodeURIComponent(String(nameOrKey||"").trim());
  };

  // Navigates to a ninja's profile — no-op for guests/empty names so it's
  // always safe to wire straight into an onClick without extra role checks.
  window.cnGoToProfile = function(nameOrKey, role){
    if(!nameOrKey || !window.cnCanViewProfiles(role)) return;
    window.location.href = window.cnProfileHref(nameOrKey);
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
  window.BREAK_DURATION_MS = 10*60*1000; // default/fallback duration (10 minutes)
  // Selectable break lengths (minutes) shown as options when a Sensei starts a break.
  window.BREAK_DURATION_OPTIONS_MIN = [5, 10, 15, 20, 30, 45, 60];
  // Returns the duration (ms) that applies to a given break entry — per-break
  // durationMs if one was set, otherwise the default. Keeps old entries
  // (saved before duration selection existed) working correctly.
  window.cnBreakDurationMs = function(entry){
    const d = Number(entry && entry.durationMs);
    return (d > 0) ? d : window.BREAK_DURATION_MS;
  };
  window.cnIsBreakActive = function(entry){
    if(!entry || !entry.startedAt) return false;
    return (Date.now()-entry.startedAt) < window.cnBreakDurationMs(entry);
  };
  window.fbBreak = {
    async getAll(){
      const snap = await db.ref("games/onBreak").once("value");
      return snap.val() || {};
    },
    // durationMs is optional — defaults to window.BREAK_DURATION_MS when omitted
    // (or when ending a break, where it's irrelevant).
    async setBreak(usernameKey, on, durationMs){
      if(on){
        const cleanDuration = (Number(durationMs) > 0) ? Number(durationMs) : window.BREAK_DURATION_MS;
        await db.ref(`games/onBreak/${usernameKey}`).set({startedAt: firebase.database.ServerValue.TIMESTAMP, durationMs: cleanDuration});
      }
      else{ await db.ref(`games/onBreak/${usernameKey}`).remove(); }
    },
    // Realtime listener — fires immediately whenever ANY window changes break
    // status (used by the Kiosk display so it updates without a refresh).
    // Returns an unsubscribe function.
    listen(callback){
      const ref = db.ref("games/onBreak");
      const handler = snap => callback(snap.val() || {});
      ref.on("value", handler);
      return () => ref.off("value", handler);
    }
  };

  // -------------------------------------------------------------------------
  // Session locks — set by a Sensei when they hit "End Session" from
  // "In The Dojo". A locked account is signed out immediately (via
  // forcedLogouts, same as before) AND is blocked from logging back in at
  // all until a Sensei explicitly presses "Unlock Session". This is
  // stronger than the old End Session, which only kicked someone out but
  // let them log right back in if they still had Points access.
  // -------------------------------------------------------------------------
  window.fbSessionLock = {
    async getAll(){
      const snap = await db.ref("sessionLocks").once("value");
      return snap.val() || {};
    },
    async lock(accountKey){
      if(!accountKey) return;
      await db.ref(`sessionLocks/${accountKey}`).set({lockedAt: Date.now()});
    },
    async unlock(accountKey){
      if(!accountKey) return;
      await db.ref(`sessionLocks/${accountKey}`).remove();
    },
    async isLocked(accountKey){
      if(!accountKey) return false;
      try{
        const snap = await db.ref(`sessionLocks/${accountKey}`).once("value");
        return snap.exists();
      }catch(e){ return false; }
    },
    // Realtime listener so "In The Dojo" flips a card to "Unlock Session"
    // the instant a lock is set/cleared, from any window.
    listen(callback){
      const ref = db.ref("sessionLocks");
      const handler = snap => callback(snap.val() || {});
      ref.on("value", handler);
      return () => ref.off("value", handler);
    }
  };

  // -------------------------------------------------------------------------
  // Points-access revocations — set from "In The Dojo" when a Sensei hits
  // "Remove from Dojo". Unlike a full session lock (which requires a manual
  // "Unlock Session" later), this only revokes access for TODAY: the ninja
  // immediately disappears from the present list, can't log back in for the
  // rest of the day even if their 2-hour window hasn't expired, and any
  // active session is force-logged-out right away. It clears itself
  // naturally tomorrow since it's checked against today's date.
  // -------------------------------------------------------------------------
  window.fbAccessRevocation = {
    async getAll(){
      const snap = await db.ref("pointsAccessRevoked").once("value");
      return snap.val() || {};
    },
    async revoke(nameKey){
      if(!nameKey) return;
      await db.ref(`pointsAccessRevoked/${nameKey}`).set({date: window.todayStr(), revokedAt: Date.now()});
    },
    async isRevokedToday(nameKey){
      if(!nameKey) return false;
      try{
        const snap = await db.ref(`pointsAccessRevoked/${nameKey}`).once("value");
        const v = snap.val();
        return !!(v && v.date === window.todayStr());
      }catch(e){ return false; }
    },
    // Realtime listener so "In The Dojo" drops a removed ninja from the
    // present list instantly, from any window.
    listen(callback){
      const ref = db.ref("pointsAccessRevoked");
      const handler = snap => callback(snap.val() || {});
      ref.on("value", handler);
      return () => ref.off("value", handler);
    }
  };

  // -------------------------------------------------------------------------
  // Project Goals — per-ninja goal + curriculum section, set by Senseis from
  // "In The Dojo" and mirrored live onto the Kiosk display for a second
  // monitor. Keyed by the same cnKeySafe account key used everywhere else
  // (breaks, sessions) so it always lines up with a linked account.
  // -------------------------------------------------------------------------
  window.CN_SECTIONS = ["Impact","JR","Robotics","Unity"];

  // Code Ninjas IMPACT curriculum, per belt. Each activity set is
  // [level, Project (Build), Explore, Debugging, Quest & Adventure].
  // Senseis pick goals for Impact ninjas from these instead of typing them.
  window.CN_GOAL_PARTS = [
    {id:"build", label:"Build", col:1},
    {id:"explore", label:"Explore", col:2},
    {id:"debug", label:"Debugging", col:3},
    {id:"quest", label:"Quest & Adventure", col:4},
  ];
  window.CN_CURRICULUM = {
    Impact: [
      {belt:"White", color:"#64748b", sets:[
        [1,"Your First Sprite","Moving Sprites Around","Debugging Our First Bugs!","Level 1 Quest & Adventure"],
        [2,"Meet New Friends!","Naming Sprites","Debugging Sequence #1","Level 2 Quest & Adventure"],
        [2,"Where’s My Puppy?","Sequencing Blocks","Debugging Sequence #2","Level 2 Quest & Adventure"],
        [3,"Fly Me to the Moon!","Moving Sprites with the Direction Buttons","Debugging Sprite Movement","Level 3 Quest & Adventure"],
        [3,"Dinner Time!","Sprite Layers","Debugging Sprite Layers","Level 3 Quest & Adventure"],
        [4,"A Piece of Cake","Overlapping Sprite Functions","Debugging Overlap Blocks","Level 4 Quest & Adventure"],
        [4,"Underwater Food Chain","Sprite Kinds and Parameters","Debugging Sprite Kinds and Parameters","Level 4 Quest & Adventure"],
      ]},
      {belt:"Yellow", color:"#b8860b", sets:[
        [1,"The Mushroom and the Munchy Munchy Monkey","Life and Countdown Variables","Debugging Life and Countdown Variables","Level 1 Quest & Adventure"],
        [1,"Pearl Collector","Score and Countdown Variables","Debugging Life and Score Variables","Level 1 Quest & Adventure"],
        [2,"Avoid the Asteroids!","Game Update Loops and Random Numbers","Debugging Loops, Velocity and Randomness!","Level 2 Quest & Adventure"],
        [2,"Space Adventure","Sprite Velocity","Debugging Projectiles","Level 2 Quest & Adventure"],
        [3,"The Wizard’s Mystic Toadstools","If/Then Conditionals","Debugging If/Then Conditionals","Level 3 Quest & Adventure"],
        [3,"Unlock the Hidden Treasure!","If/Then/Else Conditionals","Debugging If/Then/Else Conditionals","Level 3 Quest & Adventure"],
        [4,"Animated Aquarium","Sprite Animation","Debugging Animations","Yellow Belt Mastery Mission"],
        [4,"Musical Mayhem","Melody Blocks","Debugging Music Blocks","Yellow Belt Mastery Mission"],
      ]},
      {belt:"Orange", color:"#d97706", sets:[
        [1,"Avoid the Snakes!","Tilemaps and Walls","Debugging Tilemaps","Level 1 Quest & Adventure"],
        [1,"Carrot Chase","Large-Scale Tilemaps","Debugging Walls and Tiles in Tilemaps","Level 1 Quest & Adventure"],
        [2,"The Key to the Castle","Tilemap Overlap Events","Debugging Tilemap Overlap Events","Level 2 Quest & Adventure"],
        [2,"Coin Grabber!","Lifecycle Events","Debugging Lifecycle Events","Level 2 Quest & Adventure"],
        [3,"All About Me","Variables and Strings","Debugging Variables and Strings","Level 3 Quest & Adventure"],
        [3,"Welcome to the Farm","Image Arrays","Debugging Image Arrays","Level 3 Quest & Adventure"],
        [3,"Mad Libs","Text Arrays","Debugging Text Arrays","Level 3 Quest & Adventure"],
        [4,"Memory Game","Repeat Loops","Debugging Repeat Loops","Level 4 Quest & Adventure"],
        [4,"Archeological Dig","For Element Loops","Debugging For Element Loops","Level 4 Quest & Adventure"],
        [5,"Cookie Clicker Game!","Functions","Debugging Functions","Level 5 Quest & Adventure"],
        [5,"Snowflake Catch","Functions with Parameters","Debugging Functions with Parameters","Level 5 Quest & Adventure"],
      ]},
      {belt:"Green", color:"#15803d", sets:[
        [1,"Cactus Jump","Acceleration and Velocity","Debugging Acceleration and Velocity","Level 1 Quest & Adventure"],
        [1,"Avoid the Roadblocks","Spawning Sprites","Debugging 2D Tilemap Designs","Level 1 Quest & Adventure"],
        [1,"The Floor is Lava!","2D Tilemaps","Debugging 2D Tilemaps","Level 1 Quest & Adventure"],
        [2,"Magic Coin Scavenger Hunt","AND Booleans","Debugging AND Booleans","Level 2 Quest & Adventure"],
        [2,"Raindrop Invisibility","NOT Booleans","Debugging NOT Booleans","Level 2 Quest & Adventure"],
        [2,"Snake Pit!","OR Booleans","Debugging OR Booleans","Level 2 Quest & Adventure"],
        [3,"Bubble Pop!","For Index Loops","Debugging For Index Loops","Level 3 Quest & Adventure"],
        [3,"Bee Catcher","While Loops","Debugging While Loops","Level 3 Quest & Adventure"],
        [4,"Block Jumper","Tilemap Location Blocks","Debugging Tilemap Location Blocks","Level 4 Quest & Adventure"],
        [4,"Bridge Builder","Tilemap Location Blocks and Operators","Debugging Tilemap Location Blocks and Operators","Level 4 Quest & Adventure"],
        [4,"Dino Defender","Tilemap Extension Blocks","Debugging Tilemap Extension Blocks","Level 4 Quest & Adventure"],
        [5,"Scenic Drive","Scroller Extension Blocks","Debugging Scroller Extension Blocks","Green Belt Mastery Mission"],
        [5,"Burger Dash","Status Bar Extension Blocks","Debugging Status Bar Extension Blocks","Green Belt Mastery Mission"],
      ]},
      {belt:"Blue", color:"#2563eb", sets:[
        [1,"hello world!","Setting Sprites","Debugging Setting Sprites","Level 1 Quest & Adventure"],
        [1,"Bouncing on the Walls","Moving Sprites","Debugging Sprite Effects","Level 1 Quest & Adventure"],
        [1,"Follow Me!","Sprite Movements","Debugging Sprite Movements","Level 1 Quest & Adventure"],
        [2,"Greeting Card","Properties and Text Parameters","Debugging Properties and Text Parameters","Level 2 Quest & Adventure"],
        [2,"Show Time!","Effect Parameters and Sequencing","Debugging Effect Parameters and Sequencing","Level 2 Quest & Adventure"],
        [2,"Seasons Change","Dialog Boxes, Sounds, and Code Comments","Debugging Code Comments and Dialog Boxes","Level 2 Quest & Adventure"],
        [3,"Screen Saver","Block Statements and Loops","Debugging Block Statements and Loops","Level 3 Quest & Adventure"],
        [3,"Button Clicker!","Block Statements and Events","Debugging Block Statements and Events","Level 3 Quest & Adventure"],
        [3,"Two Sprite Showdown!","Screen Positions and Multiplayer Score","Debugging Screen Positions and Multiplayer Score","Level 3 Quest & Adventure"],
        [4,"Save the Crab!","Nested Block Statements and If Conditionals","Debugging Nested Block Statements and If Conditionals","Level 4 Quest & Adventure"],
        [4,"Going Bananas!","Nested Block Statements and If/Else Conditionals","Debugging Nested Block Statements and If/Else Conditionals","Level 4 Quest & Adventure"],
        [4,"Grab Bag!","Nested Block Statements and If/Else If/Else Conditionals","Debugging Nested Block Statements and If/Else If/Else Conditionals","Level 4 Quest & Adventure"],
        [5,"Shop Til You Drop","Variables, Concatenation, and Assignment Operators","Debugging Variables, Concatenation, and Assignment Operators","Level 5 Quest & Adventure"],
        [5,"Cookie Stacker","Assignment and Equality Operators","Debugging Variables, Equality Operators, and Math Operators","Level 5 Quest & Adventure"],
        [6,"Shooting Hoops!","Boolean AND Operators and Relational Operators","Debugging Boolean AND Operators and Relational Operators","Level 6 Quest & Adventure"],
        [6,"Guess the Number!","Boolean OR Operators","Debugging Boolean OR Operators","Level 6 Quest & Adventure"],
      ]},
      {belt:"Purple", color:"#7c3aed", sets:[
        [1,"Collect the Honey!","Sprite Kinds and Overlap Events","Debugging Sprite Kinds and Overlap Events","Level 1 Quest & Adventure"],
        [1,"Snowball Fight!","Sprite Kinds and Overlap Events","Debugging Sprite Kinds and Projectiles","Level 1 Quest & Adventure"],
        [1,"Asteroid Attack!","Sprite Kinds and onCreated Events","Debugging Sprite Kinds and onCreated Events","Level 1 Quest & Adventure"],
        [2,"Fireflies Collector","For Loops","Debugging For Loops","Level 2 Quest & Adventure"],
        [2,"Counting Sprites","Incrementing and Decrementing For Loops","Debugging Incrementing and Decrementing For Loops","Level 2 Quest & Adventure"],
        [2,"Mystery Boxes!","Nested For Loops and Increment Operators","Debugging Nested For Loops and Increment Operators","Level 2 Quest & Adventure"],
        [3,"Magic 8 Ball","Arrays","Debugging Arrays","Level 3 Quest & Adventure"],
        [3,"What’s in a Name?","Empty Arrays and Array Functions","Debugging Empty Arrays","Level 3 Quest & Adventure"],
        [3,"Concentration","Array Indices and For Element Of Loops","Debugging Array Indices and For Element Of Loops","Level 3 Quest & Adventure"],
        [4,"Match Game","Array Index Values","Debugging Array Index Values","Level 4 Quest & Adventure"],
        [4,"Username Generator","Nested Arrays","Debugging Nested Arrays","Level 4 Quest & Adventure"],
        [4,"Memory Match","Array Functions","Debugging Array Functions","Level 4 Quest & Adventure"],
        [5,"Pizza Party","Functions with Parameters","Debugging Functions with Parameters","Level 5 Quest & Adventure"],
        [5,"Barn Breakout!","Refactoring and Function Scope","Debugging Multiple Functions","Level 5 Quest & Adventure"],
        [5,"Damage Control","Function Documentation and Calling Functions","Debugging Functions with Multiple Parameters","Level 5 Quest & Adventure"],
        [6,"Escape the Haunted Castle!","Animation and Music","Debugging Animation and Music","Purple Belt Mastery Mission"],
        [6,"City Scroller","Scroller Extension","Debugging the Scroller Extension","Purple Belt Mastery Mission"],
        [6,"Find the Ninja!","Story Extension","Debugging the Story Extension","Purple Belt Mastery Mission"],
      ]},
      {belt:"Brown", color:"#92400e", sets:[
        [1,"The Bookcase","Tilemap Assets","Debugging Assets and Tilemaps","Level 1 Quest & Adventure"],
        [1,"Shark Attack","Spawn Tiles and Camera Functions","Debugging Tilemap Location and Camera Functions","Level 1 Quest & Adventure"],
        [2,"Two Worlds","Tile Overlap Events","Debugging Tile Overlap Events","Level 2 Quest & Adventure"],
        [2,"Avoid the Haystacks!","Tilemap Wall Events","Debugging Tilemap Walls","Level 2 Quest & Adventure"],
        [3,"Dust Mite Adventure","2D Tilemap Movement","Debugging 2D Tilemap Movement","Level 3 Quest & Adventure"],
        [3,"Gravity Jumper","Sprite Movement with Functions","Debugging Sprite Movement with Functions","Level 3 Quest & Adventure"],
        [3,"Salmon Catch","Tile Overlaps and While Loops","Debugging Tile Overlaps and While Loops","Level 3 Quest & Adventure"],
        [4,"A Walk through the Seasons","Image Editing and Scrolling Backgrounds","Debugging Customized Assets and the Scroller Extension","Level 4 Quest & Adventure"],
        [4,"A Change of Scenery","Image Modification and Cycling Through Assets","Debugging Cycling through Assets","Level 4 Quest & Adventure"],
        [5,"Creating Custom Pixel Art","Custom Pixel Art","Debugging Custom Pixel Art","Level 5 Quest & Adventure"],
        [5,"Pixel Art Colors & Outlines","Pixel Art Colors & Outlines","Debugging Pixel Art Colors & Outlines","Level 5 Quest & Adventure"],
        [5,"Pixel Art Shading - Shadows & Reflections","Pixel Art Shading - Shadows & Reflections","Debugging Pixel Art Shading","Level 5 Quest & Adventure"],
        [5,"Pixel Art Dithering","Dithering in Pixel Art","Debugging Dithering in Pixel Art","Level 5 Quest & Adventure"],
        [5,"Creating Pixel Art in Multiple Sizes","Pixel Art in Multiple Sizes","Debugging Pixel Art in Multiple Sizes","Level 5 Quest & Adventure"],
        [6,"Create Sprites from Multiple Perspectives","Pixel Art Sprite Perspectives","Debugging Sprite Perspectives","Level 6 Quest & Adventure"],
        [6,"Create a Color Palette for a Sprite Pack","Pixel Art Sprite Packs","Debugging Pixel Art Sprite Packs","Level 6 Quest & Adventure"],
        [6,"Creating and Using a Sprite Pack","Creating and Using Sprite Packs","Debugging Projectile Sprite Perspectives","Level 6 Quest & Adventure"],
        [7,"Animation Techniques","Squash and Stretch","Debugging Animation Techniques","Level 7 Quest & Adventure"],
        [7,"A Cozy Evening","Animation Layers","Debugging Animating Multiple Sprite Movement","Level 7 Quest & Adventure"],
        [7,"Super Ninja!","Sprite Walk Cycles","Debugging Sprite Animation","Level 7 Quest & Adventure"],
        [8,"Hills and Ladders","Creating 2D Tilemap Tiles","Debugging 2D Tilemap Tiles","Level 8 Quest & Adventure"],
        [8,"We Built this City!","Building with Multiple Custom Tiles","Debugging Building with Multiple Custom Tiles","Level 8 Quest & Adventure"],
        [9,"Maze Masters","Text Sprites","Debugging Text Sprites","Level 9 Quest & Adventure"],
        [9,"A Pet’s Day","Full Screen Image Assets","Debugging Scene Sequence and Dialog Text","Level 9 Quest & Adventure"],
        [10,"Painter’s Palette","Pixel Color Functions","Debugging Pixel Color Functions","Brown Belt Mastery Mission"],
        [10,"Maps of all Sizes!","Minimaps","Debugging Minimaps","Brown Belt Mastery Mission"],
        [10,"Feed The Hungry Dinos!","Status Bars and Timers","Debugging Timers and Status Bars","Brown Belt Mastery Mission"],
        [10,"Museum Heist","Raycasting","Debugging Raycasting","Brown Belt Mastery Mission"],
      ]},
      {belt:"Red", color:"#b91c1c", sets:[
        [1,"First Hole","Sprite Physics","Debugging Sprite Physics","Adventure Golf"],
        [1,"A Multi-Perspective Golf Course","Multi-Tilemap Game Mechanics","Debugging Tilemap Transitions","Adventure Golf"],
        [1,"Adventure Golf","UI/UX Features","Debugging Projects Using the setText Function","Adventure Golf"],
        [2,"First Wave","Setting Towers and Launching Projectiles","Debugging Projectile Movement","Tower Defense Project"],
        [2,"Many Enemies, Many Paths!","Enemy Sprite Movement and On-Screen Text","Debugging Sprite Movement and Image Consistency","Tower Defense Project"],
        [2,"Inventory Menu","Creating an Inventory Menu","Image Functions","Tower Defense Project"],
        [2,"Finishing Touches","Project Scene Organization","Debugging Code by Project Scene","Tower Defense Project"],
      ]},
      // Black Belt is a single capstone — no separate debugging activity.
      {belt:"Black", color:"#111827", sets:[
        [1,"Capstone Project!","Planning, design, coding, UI/UX and playtesting",null,"Original independent project"],
      ]},
    ],
  };
  // Builds the goal text shown on the kiosk, e.g.
  // "Yellow Belt · L2 · Build: Avoid the Asteroids!"
  window.cnCurriculumGoalText = function(section, beltName, setIdx, partId){
    const belts = (window.CN_CURRICULUM[section] || []);
    const belt = belts.find(b => b.belt === beltName);
    const set = belt && belt.sets[setIdx];
    const part = window.CN_GOAL_PARTS.find(p => p.id === partId);
    if(!belt || !set || !part || !set[part.col]) return "";
    return `${belt.belt} Belt · L${set[0]} · ${part.label}: ${set[part.col]}`;
  };

  // Goals only last for the ninja's current visit: each one is stamped with
  // the day it was set, a ninja's first Points entry of the day wipes it
  // ("new sign-in = no goal"), and CodeBot deletes it once their sign-in
  // window closes. Anything not from today is treated as no goal.
  window.cnGoalActive = function(g){ return !!(g && g.goal && g.date === window.todayStr()); };
  function activeGoals(all){
    const out = {};
    for(const [k,g] of Object.entries(all || {})) if(window.cnGoalActive(g)) out[k] = g;
    return out;
  }
  window.fbGoals = {
    async getAll(){
      const snap = await db.ref("goals").once("value");
      return activeGoals(snap.val());
    },
    // extra: optional structured info, e.g. {belt, setIdx, part, project}
    async setGoal(accountKey, name, section, goal, extra){
      await db.ref(`goals/${accountKey}`).set(Object.assign({
        name: name || "", section: section || "", goal: goal || "", date: window.todayStr(), updatedAt: Date.now()
      }, extra || {}));
    },
    async clearGoal(accountKey){
      if(!accountKey) return;
      await db.ref(`goals/${accountKey}`).remove();
    },
    // Realtime listener — fires immediately on any change, from any window.
    // Only today's goals are passed on.
    listen(callback){
      const ref = db.ref("goals");
      const handler = snap => callback(activeGoals(snap.val()));
      ref.on("value", handler);
      return () => ref.off("value", handler);
    }
  };
  // Called when a ninja gets their FIRST Points entry of the day: they start
  // the visit with no goal until a Sensei assigns one.
  window.cnResetGoalOnSignIn = async function(name, usernames){
    const keys = new Set([window.cnKeySafe(name)]);
    try{
      const list = usernames || await window.fbUsernames.getAll();
      const linked = window.findLinkedAccount(name, list);
      if(linked) keys.add(window.cnKeySafe(linked));
    }catch(e){}
    await Promise.all([...keys].map(k => window.fbGoals.clearGoal(k).catch(()=>{})));
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

  // Given the first-name recorded on a Points entry, finds the matching full
  // registered username (e.g. "adam" -> "adam.dodo") if one exists. Shared by
  // "In The Dojo" and the Kiosk display so both agree on which ninjas are
  // actually linked to an account (and therefore can have goals/breaks set).
  window.findLinkedAccount = function(firstName, usernames){
    const target = String(firstName).trim().toLowerCase();
    if(!target) return null;
    usernames = usernames || [];
    let match = usernames.find(u=>{
      const seg = u.split(".")[0];
      return seg && seg.toLowerCase()===target;
    });
    if(match) return match;
    match = usernames.find(u=>u.toLowerCase()===target);
    return match || null;
  };

  // -------------------------------------------------------------------------
  // Session handling
  //  - sessionStorage (not localStorage) means closing the tab signs you out.
  //  - Only ninjas with a Points entry logged TODAY, within the last 2 hours,
  //    may log in as a student — otherwise the login is rejected.
  //  - Firebase "activeSessions/<account>" enforces a single login per
  //    account (admin or a given ninja) at a time.
  // -------------------------------------------------------------------------
  window.SESSION_HOURS = 2; // default sign-in length
  // Sign-in lengths a Sensei can pick on Points (hours).
  window.CN_SESSION_HOUR_OPTIONS = [1, 2, 3];
  // A ninja stays signed in / listed in the dojo for their sign-in length
  // PLUS this much extra time.
  window.SESSION_GRACE_MIN = 20;
  window.SESSION_GRACE_MS = window.SESSION_GRACE_MIN*60*1000;
  // Max Points entries per ninja per day (Points tab + CodeBot both enforce it).
  window.CN_MAX_ATTEMPTS_PER_DAY = 3;
  window.SESSION_MS = window.SESSION_HOURS*60*60*1000;
  window.cnCleanHours = function(h){
    const n = Number(h);
    return window.CN_SESSION_HOUR_OPTIONS.includes(n) ? n : window.SESSION_HOURS;
  };
  // When a ninja's access ends, given the time of their latest Points entry
  // today and its sign-in length. The single rule used by login, In The Dojo,
  // the kiosk, CodeBot and goal clean-up.
  window.cnAccessEndsAt = function(createdAt, hours){
    return (Number(createdAt)||0) + window.cnCleanHours(hours)*60*60*1000 + window.SESSION_GRACE_MS;
  };
  // Today's Points entries -> one row per ninja: {name, points, attempts,
  // lastSeen (latest entry time), hours (that entry's sign-in length), endsAt}.
  window.cnPresenceFromEntries = function(entries, today){
    today = today || window.todayStr();
    const map = {};
    for(const e of entries || []){
      if(!e || !e.name || e.date !== today) continue;
      const key = e.name.trim().toLowerCase();
      if(!map[key]) map[key] = {name:e.name.trim(), points:0, attempts:0, lastSeen:0, hours:window.SESSION_HOURS};
      const m = map[key];
      m.name = e.name.trim();
      m.points += Number(e.points)||0;
      m.attempts += 1;
      if((e.createdAt||0) >= m.lastSeen){ m.lastSeen = e.createdAt||0; m.hours = window.cnCleanHours(e.sessionHours); }
    }
    return Object.values(map).map(m => Object.assign(m, {endsAt: m.lastSeen ? window.cnAccessEndsAt(m.lastSeen, m.hours) : 0}));
  };

  // Minimum time a Sensei must wait between two Points entries for the SAME
  // ninja (regardless of which day each entry is logged against — this is a
  // real-world "don't double-enter the same kid back to back" cooldown, not
  // a per-day rule). Used by entrygames.html.
  window.ENTRY_COOLDOWN_MINUTES = 20;
  window.ENTRY_COOLDOWN_MS = window.ENTRY_COOLDOWN_MINUTES*60*1000;
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
      // Points entries are usually saved under first name only (e.g. "Nathan"),
      // but when two ninjas share a first name, entrygames.html disambiguates
      // by saving the full registered username instead (e.g. "Nathan.blah").
      // Students always log in with their full username, so accept a match
      // against either stored form.
      const fullTyped = trimmed.toLowerCase();
      const firstName = trimmed.split(".")[0].trim().toLowerCase();
      const today = window.todayStr();
      let all = [];
      try{ all = await window.fbLeaderboard.getAll(); }
      catch(e){ return {ok:false, reason:"error"}; }
      const matches = all.filter(e => {
        if(e.date !== today || !e.name) return false;
        const stored = e.name.trim().toLowerCase();
        return stored === firstName || stored === fullTyped;
      });
      if(matches.length === 0) return {ok:false, reason:"not_entered"};
      const mostRecentEntry = matches.reduce((latest,e)=>(e.createdAt||0) > (latest.createdAt||0) ? e : latest, {createdAt:0});
      const mostRecent = mostRecentEntry.createdAt || 0;
      if(!mostRecent) return {ok:false, reason:"not_entered"};
      const sessionHours = window.cnCleanHours(mostRecentEntry.sessionHours);
      const endsAt = window.cnAccessEndsAt(mostRecent, sessionHours); // sign-in length + 20 min
      if(Date.now() > endsAt) return {ok:false, reason:"expired"};
      // A Sensei can remove a ninja from "In The Dojo" to revoke today's
      // access immediately, even if the 2-hour window hasn't expired yet.
      const revokedFull = await window.fbAccessRevocation.isRevokedToday(window.cnKeySafe(fullTyped));
      const revokedFirst = await window.fbAccessRevocation.isRevokedToday(window.cnKeySafe(firstName));
      if(revokedFull || revokedFirst) return {ok:false, reason:"removed"};
      // Keep the full login name (e.g. "nathan.blah") as the matched identity,
      // not just the first name, so accountKey/session/display stay correct.
      return {ok:true, matchedName: trimmed, enteredAt: mostRecent, sessionHours, expiresAt: endsAt};
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
      const locked = await window.fbSessionLock.isLocked(accountKey);
      if(locked) return {ok:false, reason:"locked"};
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
    },

    // Lets an admin immediately end a specific ninja's active session from
    // another device (e.g. "In The Dojo"). Frees up their login slot right
    // away, sets a flag the ninja's own tab picks up within ~20s to log
    // them out automatically (belt-and-suspenders alongside the immediate
    // client-side logout below), and locks the account so it can't be
    // logged back into until a Sensei presses "Unlock Session".
    async endSession(accountKey){
      if(!accountKey) return;
      try{ await db.ref(`activeSessions/${accountKey}`).remove(); }catch(e){}
      try{ await db.ref(`sessionLocks/${accountKey}`).set({lockedAt: Date.now()}); }catch(e){}
      try{ await db.ref(`forcedLogouts/${accountKey}`).set("session_ended"); }catch(e){}
    },

    // Reverses endSession's lock, letting the ninja log back in (assuming
    // they still otherwise have valid Points access).
    async unlockSession(accountKey){
      if(!accountKey) return;
      try{ await db.ref(`sessionLocks/${accountKey}`).remove(); }catch(e){}
    },

    // Immediately force-logs-out whichever session (if any) is active under
    // this key, without locking the account long-term — used by "Remove from
    // Dojo" alongside fbAccessRevocation, which handles blocking today's
    // logins on its own.
    async forceLogoutKey(accountKey){
      if(!accountKey) return;
      try{ await db.ref(`activeSessions/${accountKey}`).remove(); }catch(e){}
      try{ await db.ref(`forcedLogouts/${accountKey}`).set("removed"); }catch(e){}
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
          try{
            const locked = await window.fbSessionLock.isLocked(s.accountKey);
            if(locked){ window.cnSession.logout("session_ended"); return; }
          }catch(e){}
          try{
            const removed = await window.fbAccessRevocation.isRevokedToday(s.accountKey);
            if(removed){ window.cnSession.logout("removed"); return; }
          }catch(e){}
        }
      }, 20000);
      return ()=>clearInterval(iv);
    },[]);
    // Realtime "End Session" trigger — instead of waiting on the 20s poll
    // above, this listens live on forcedLogouts/<accountKey> so a Sensei
    // pressing "End Session" from another window kicks this tab out the
    // instant Firebase pushes the change (typically well under a second),
    // not up to 20 seconds later.
    React.useEffect(()=>{
      const s = window.cnSession.getSession();
      if(!s || s.role !== "student" || !s.accountKey) return;
      const ref = db.ref(`forcedLogouts/${s.accountKey}`);
      const handler = snap => {
        if(!snap.exists()) return;
        const val = snap.val();
        const reason = (typeof val === "string") ? val : "session_ended";
        try{ ref.remove(); }catch(e){}
        window.cnSession.logout(reason);
      };
      ref.on("value", handler);
      return () => ref.off("value", handler);
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
    resume(){
      const idx = Number(sessionStorage.getItem("cn_tour_step")||0);
      const tab = window.CN_NAV.find(n=>n.id===window.CN_TOUR_TABS[idx]) || window.CN_NAV[0];
      window.location.href = tab.href;
    },
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

  // -------------------------------------------------------------------------
  // In-page dialogs — replace the browser's native prompt()/alert() popups
  // with styled modals that match the site. Plain DOM (no React) so any page
  // or script can await them.
  //   await cnDialog.password({title, message, confirmLabel, danger})
  //     -> true once the correct Sensei password is entered, false on cancel.
  //        The input is masked; a wrong password shows an inline error and
  //        lets the Sensei retry without reopening anything.
  //   await cnDialog.alert(message, {title})
  // -------------------------------------------------------------------------
  function cnDialogStyles(){
    if(document.getElementById("cn-dialog-styles")) return;
    const st = document.createElement("style");
    st.id = "cn-dialog-styles";
    st.textContent = `
      .cn-dlg-back{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;
        background:rgba(0,0,0,0.72);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);animation:cnDlgFade .15s ease}
      .cn-dlg{width:100%;max-width:380px;background:rgba(12,12,20,0.98);border:1px solid rgba(57,255,20,0.3);border-radius:16px;
        padding:22px;box-shadow:0 20px 60px rgba(0,0,0,0.6),0 0 30px rgba(57,255,20,0.12);font-family:'Exo 2',sans-serif;color:#fff;
        animation:cnDlgPop .2s ease}
      .cn-dlg.danger{border-color:rgba(255,45,120,0.4);box-shadow:0 20px 60px rgba(0,0,0,0.6),0 0 30px rgba(255,45,120,0.15)}
      .cn-dlg h3{font-family:'Orbitron',sans-serif;font-size:14px;margin:0 0 8px;color:#fff;letter-spacing:.5px}
      .cn-dlg p{font-size:13px;line-height:1.55;color:rgba(255,255,255,0.65);margin:0 0 16px}
      .cn-dlg label{display:block;font-family:'Fira Code',monospace;font-size:10px;letter-spacing:1px;color:rgba(255,255,255,0.45);margin-bottom:7px}
      .cn-dlg input{width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.18);border-radius:10px;
        padding:11px 14px;color:#fff;font-size:15px;outline:none;font-family:'Fira Code',monospace;letter-spacing:2px}
      .cn-dlg input:focus{border-color:#39ff14}
      .cn-dlg input.bad{border-color:#ff2d78;animation:cnDlgShake .3s}
      .cn-dlg .err{min-height:16px;font-family:'Fira Code',monospace;font-size:10px;color:#ff2d78;margin:6px 0 10px}
      .cn-dlg .row{display:flex;gap:8px}
      .cn-dlg button{flex:1;padding:10px;border-radius:9px;cursor:pointer;font-family:'Orbitron',sans-serif;font-weight:700;font-size:11px;letter-spacing:1px}
      .cn-dlg .cancel{border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.6)}
      .cn-dlg .ok{border:none;background:linear-gradient(135deg,#39ff14,#00cfff);color:#000}
      .cn-dlg.danger .ok{background:linear-gradient(135deg,#ff2d78,#ff8c00)}
      @keyframes cnDlgFade{from{opacity:0}to{opacity:1}}
      @keyframes cnDlgPop{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
      @keyframes cnDlgShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
    `;
    document.head.appendChild(st);
  }
  function cnEl(tag, attrs, children){
    const el = document.createElement(tag);
    if(attrs) for(const [k,v] of Object.entries(attrs)){
      if(k === "text") el.textContent = v;
      else if(k === "class") el.className = v;
      else el.setAttribute(k, v);
    }
    (children||[]).forEach(c => c && el.appendChild(c));
    return el;
  }
  window.cnDialog = {
    password(opts){
      opts = opts || {};
      cnDialogStyles();
      return new Promise(resolve => {
        const input = cnEl("input",{type:"password",autocomplete:"off",placeholder:"••••••••"});
        const err = cnEl("div",{class:"err"});
        const cancel = cnEl("button",{class:"cancel",type:"button",text:"CANCEL"});
        const ok = cnEl("button",{class:"ok",type:"button",text:opts.confirmLabel || "CONFIRM"});
        const box = cnEl("div",{class:"cn-dlg"+(opts.danger?" danger":""),role:"dialog","aria-modal":"true"},[
          cnEl("h3",{text:opts.title || "🔐 Sensei password"}),
          opts.message ? cnEl("p",{text:opts.message}) : null,
          cnEl("label",{text:"SENSEI PASSWORD"}),
          input, err,
          cnEl("div",{class:"row"},[cancel, ok])
        ]);
        const back = cnEl("div",{class:"cn-dlg-back"},[box]);
        function close(result){
          document.removeEventListener("keydown", onKey, true);
          back.remove();
          resolve(result);
        }
        function attempt(){
          if(input.value === window.CN_ADMIN_PASS){ close(true); return; }
          err.textContent = input.value ? "Incorrect password — try again." : "Enter the password.";
          input.classList.remove("bad"); void input.offsetWidth; input.classList.add("bad");
          input.select();
        }
        function onKey(e){
          if(e.key === "Escape"){ e.stopPropagation(); close(false); }
          else if(e.key === "Enter"){ e.preventDefault(); attempt(); }
        }
        cancel.onclick = () => close(false);
        ok.onclick = attempt;
        back.onclick = e => { if(e.target === back) close(false); };
        input.oninput = () => { err.textContent = ""; input.classList.remove("bad"); };
        document.addEventListener("keydown", onKey, true);
        document.body.appendChild(back);
        setTimeout(()=>input.focus(), 30);
      });
    },
    alert(message, opts){
      opts = opts || {};
      cnDialogStyles();
      return new Promise(resolve => {
        const ok = cnEl("button",{class:"ok",type:"button",text:"OK"});
        const box = cnEl("div",{class:"cn-dlg"+(opts.danger?" danger":""),role:"alertdialog","aria-modal":"true"},[
          cnEl("h3",{text:opts.title || "Heads up"}),
          cnEl("p",{text:String(message||"")}),
          cnEl("div",{class:"row"},[ok])
        ]);
        const back = cnEl("div",{class:"cn-dlg-back"},[box]);
        function close(){ document.removeEventListener("keydown", onKey, true); back.remove(); resolve(); }
        function onKey(e){ if(e.key === "Escape" || e.key === "Enter"){ e.preventDefault(); close(); } }
        ok.onclick = close;
        back.onclick = e => { if(e.target === back) close(); };
        document.addEventListener("keydown", onKey, true);
        document.body.appendChild(back);
        setTimeout(()=>ok.focus(), 30);
      });
    }
  };
})();
