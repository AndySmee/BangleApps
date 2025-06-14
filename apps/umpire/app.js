// settings and environment 
var settings = Object.assign({
  // default values
  ballsPerOver: 6,
  oversPerInnings: 40,
  heartRateLimit: 130
}, require('Storage').readJSON("umpire.json", true) || {});
const BALLS_PER_OVER = settings.ballsPerOver;
const OVERS_PER_INNINGS = settings.oversPerInnings;
const HEART_RATE_LIMIT = settings.heartRateLimit;
delete settings;
const TIMEZONE_OFFSET_HOURS = (new Date()).getTimezoneOffset() / 60;
const STEP_COUNT_OFFSET = Bangle.getStepCount();
const BALL_TO_COME_CHAR = '-';
const BALL_FACED_CHAR = '=';
const DEBUG_TO = 'console'; // console/screen/none

// debug to screen option:
if(DEBUG_TO=='screen') Terminal.setConsole(1);

// globals
var processing = true; //debounce to inhibit twist events
var wickets = 0;
var counter = 0;
var over = 0;
var ballTimes = [];
var overTimes = [];
var timeTimes = [];
var log = [];
var timeCalled = false;
var batteryPercents = [];
var battery = 0;
var heartRate = '';
var heartRateEventSeconds = 0;
var HRM = false;
var PCS = {
  connected: false,
  pairs: false,
  overAndBall: '',
  over: 0,
  ball: 0,
  previousBall: 0,
  wickets: 0,
  previousWickets: 0,
  runs: 0,
  previousRuns: 0,
  balls1Faced: 0,
  previousBalls1Faced: 0,
  balls2Faced: 0,
  previousBalls2Faced: 0,
  bat1Runs: 0,
  previousBat1Runs: 0,
  bat2Runs: 0,
  previousBat2Runs: 0,
  onStrike: 1,
  previousOnStrike: 1,
  score: '',
  fieldingRuns: 0,
  decision: '',
  lastMessage: {
    scoreType: '',
    scoreData: '',
    delivery: '',
    graph: '',
    fairDelivery: false,
    runs: 0,
    ballsFaced: 0,
    batRuns: 0
  },
  signalStrength: 0,
  overLog: [] 
};

function toggleHRM() {
  if(HRM) {
    Bangle.setHRMPower(0);
    HRM = false;
    heartRateEventSeconds = 0;
    heartRate = '';
  } else {
    Bangle.setHRMPower(1);
    HRM = true;
  }
}

function getBattery() {
  // calculate last 10 moving average %
  batteryPercents.push(E.getBattery());
  if(batteryPercents.length > 10) batteryPercents.shift();
  return Math.round(batteryPercents.reduce((avg,e,i,arr)=>avg+e/arr.length,0));
}
 
// process heart rate monitor event 
// each second (approx.)
function updateHeartRate(h) {
  heartRate = h.bpm || 0;
  if(heartRate >= HEART_RATE_LIMIT) {
    heartRateEventSeconds++;
    if(heartRateEventSeconds==10) 
      addLog((new Date()), over, counter, 
        "Heart Rate", ">" + HEART_RATE_LIMIT);
  }
  if(heartRateEventSeconds > 10 
     && heartRate < HEART_RATE_LIMIT) 
      heartRateEventSeconds = -10;
}

// write events to storage (csv, persistent) 
// and memory (can be truncated while running)
function addLog(timeSig, over, ball, matchEvent, metaData) {
  var steps = Bangle.getStepCount() - STEP_COUNT_OFFSET;
  // write to storage
  var csv = [
    formatTimeOfDay(timeSig),
    over-1, ball, 
    matchEvent, metaData, 
    steps, battery, heartRate
  ];
  file.write(csv.join(",")+"\n");
  // write to memory
  log.unshift({ // in rev. chrono. order
    time: formatTimeOfDay(timeSig),
    over: over-1,
    ball: ball,
    matchEvent: matchEvent,
    metaData: metaData,
    steps: steps,
    battery: battery,
    heartRate: heartRate
  });
}

// display log from memory (not csv)
function showLog() {
  processing = true;
  Bangle.setUI();
  return E.showScroller({
    h: 50, c: log.length,
    draw: (idx, r) => {
      g.setBgColor((idx&1)?"#000":"#112").clearRect(r.x,r.y,r.x+r.w-1,r.y+r.h-1);
      if(log[idx].matchEvent==/*LANG*/"Over Duration"
        || log[idx].matchEvent==/*LANG*/"Innings Duration") {
        g.setFont("Vector", 22).drawString(
          log[idx].matchEvent,r.x+6,r.y+2);
      } else {
        g.setFont("Vector", 22).drawString(
          log[idx].over + "." +
          log[idx].ball + " " +
          log[idx].matchEvent,r.x+6,r.y+2);
      }
      g.setFont("Vector", 18).drawString(
        log[idx].time + " " +
        log[idx].metaData + " " +
        log[idx].heartRate,r.x+6,r.y+27);
    },
    select: (idx) => {
      resumeGame();
    }
  });
}

// format date (diff) as duration
function formatDuration(timeDate) { 
  return (timeDate.getHours() + TIMEZONE_OFFSET_HOURS) + ":" 
    + timeDate.getMinutes().toString().padStart(2, "0") + ":" 
    + timeDate.getSeconds().toString().padStart(2, "0") + "";
}

// format date as clock
function formatTimeOfDay(timeSig) { 
  return timeSig.getHours() + ":" 
    + timeSig.getMinutes().toString().padStart(2, "0");
}

// log Play-Cricket Scorer app score event from Bluetooth
function logPCS(scoreType, scoreData) {
  PCS.connected = true;
  switch(scoreType) {
  case 'COV':
    // PCS.overLog.push(PCS.lastMessage.graph);
    addLog((new Date()), over, counter, 
        "PCS Over", PCS.overLog);
    PCS.overLog = [];
    PCS.lastMessage.delivery = '';
    break;
  case 'OVB': // over ball
    PCS.previousBall = PCS.ball;
    var PCSOverAndBallArray = scoreData.split('.');
    PCS.over = parseInt(PCSOverAndBallArray[0]);
    if(PCSOverAndBallArray.length==1) {
      PCS.ball = 0;
      PCS.overAndBall = scoreData + '.0';
    } else {
      PCS.ball = parseInt(PCSOverAndBallArray[1]);
      PCS.overAndBall = scoreData;
    }
    PCS.previousRuns = PCS.runs;
    PCS.previousBalls1Faced = PCS.balls1Faced;
    PCS.previousBalls2Faced = PCS.balls2Faced;
    PCS.previousOnStrike = PCS.onStrike;
    PCS.previousBat1Runs = PCS.bat1Runs;
    PCS.previousBat2Runs = PCS.bat2Runs;
    PCS.previousWickets = PCS.wickets;
    //if(PCS.lastMessage.scoreType=='COV') PCS.overLog = [];
    PCS.overLog.push(PCS.lastMessage.graph);
    
    addLog((new Date()), over, counter, 
        "PCS Ball", PCS.overAndBall + ' (' + PCS.signalStrength + 'dB)');   
    if(DEBUG_TO=='console') console.log('PCS OVB', PCS.over, PCS.ball);
    Bangle.buzz(50); 
    // Start scanning
    NRF.setRSSIHandler(function(rssi) {
      PCS.signalStrength = rssi; // -85 (or similar)
      // Stop Scanning
      NRF.setRSSIHandler();
    });
    break;
  case 'BTS': // batters score
    var PCSScoreArray = scoreData.split('/');
    if(PCS.lastMessage.scoreType!='OVB') {
      PCS.previousBall = PCS.ball;
      PCS.previousRuns = PCS.runs;
      PCS.previousOnStrike = PCS.onStrike;
      PCS.previousBalls1Faced = PCS.balls1Faced;
      PCS.previousBalls2Faced = PCS.balls2Faced;
      PCS.previousBat1Runs = PCS.bat1Runs;
      PCS.previousBat2Runs = PCS.bat2Runs;
      PCS.previousWickets = PCS.wickets;
      if(PCS.lastMessage.scoreType=='COV') PCS.overLog = [];
      PCS.overLog.push(PCS.lastMessage.graph);
    }
    PCS.runs = parseInt(PCSScoreArray[0]);
    if(PCSScoreArray.length==1) {
      PCS.wickets = 0;
      PCS.pairs = true;
    } else {
      PCS.wickets = parseInt(PCSScoreArray[1]);
    }
    PCS.score = scoreData;
    addLog((new Date()), over, counter, 
        "PCS Score", PCS.score);
    if(DEBUG_TO=='console') console.log('PCS BTS', PCS.runs, PCS.wickets);
    Bangle.buzz(50); 
    break;
  case 'B1S': // bat 1 score
    PCS.bat1Runs = parseInt(scoreData);
    break;
  case 'B2S': // bat 2 score
    PCS.bat2Runs = parseInt(scoreData);
    break;
  case 'B1B': // bat 1 balls faced
    PCS.balls1Faced = parseInt(scoreData);
    break;
  case 'B2B': // bat 2 balls faced
    PCS.balls2Faced = parseInt(scoreData);
    break; 
  case 'B1K': // bat 1 on strike?
    PCS.onStrike = (scoreData=='1')? 1: PCS.onStrike;
    break;
  case 'B2K': // bat 2 on strike?
    PCS.onStrike = (scoreData=='1')? 2: PCS.onStrike;
    break; 
  case 'LWD': // batters score
    PCS.decision = PCS.wickets + ' ' + scoreData;
    addLog((new Date()), over, counter, 
        "PCS Wicket", PCS.decision);
    if(DEBUG_TO=='console') console.log('PCS Wicket' + PCS.decision);
    Bangle.buzz(50); 
    break;
  case 'FTS': // fielding score
    PCS.fieldingRuns = parseInt(scoreData);
    break; 
  default:
    
    // scoreboard encoding
  /*
. = [cov. +] ovb + bnb
1/3/5 = ovb + bts + b1s/b1b/b1k0 + b2k1
2/4/6 = ovb + bts + b1s/b1b
wd = bts
nb = bts + b1b
b = ovb + bts + b1k1 + b2b/b2k0
lb = ovb + bts + b1b/b1k0 + b2k1
last ball of over = ovb0 + ovr + r/b/lb
new over = cov + bnki/bnkj
wicket = ovb/bts + bns0/bnb0 + lwk/lwd + bnkj
rrq runs reqd
rrr runrate reqd
btn batting
fts fielding total score
*/
  }
  if(scoreType!='OVB' && scoreType!='COV') {
    PCS.lastMessage.runs = PCS.runs - PCS.previousRuns;
    PCS.lastMessage.ballsFaced = - PCS.previousBalls1Faced + PCS.balls1Faced - PCS.previousBalls2Faced + PCS.balls2Faced;
    PCS.lastMessage.batRuns = - PCS.previousBat1Runs + PCS.bat1Runs - PCS.previousBat2Runs + PCS.bat2Runs;
    PCS.lastMessage.fairDelivery = PCS.previousBall != PCS.ball;
    // create delivery text for screen & graph
    PCS.lastMessage.delivery = PCS.lastMessage.runs;
    PCS.lastMessage.graph = BALL_FACED_CHAR;//PCS.lastMessage.runs;
    if(PCS.wickets - PCS.previousWickets!=0) {
      PCS.lastMessage.delivery = 'W' + PCS.decision;
      PCS.lastMessage.graph = 'W';
    } else if(PCS.lastMessage.delivery =='') {
      if(PCS.previousOnStrike!=PCS.onStrike && PCS.ball!=0) {
        PCS.lastMessage.delivery = 'W?';
        PCS.lastMessage.graph = 'W';
      } else {
        PCS.lastMessage.delivery = '*';
        PCS.lastMessage.graph = BALL_FACED_CHAR; //'*';
      }
    } else if(PCS.lastMessage.ballsFaced==0) {
      PCS.lastMessage.delivery += 'wd';
      PCS.lastMessage.graph = '+';
    } else if(!PCS.lastMessage.fairDelivery) {
      if(PCS.lastMessage.batRuns==0) {
        PCS.lastMessage.delivery += 'nb';
        PCS.lastMessage.graph = 'O';
      } else {
        PCS.lastMessage.delivery = (PCS.lastMessage.runs - PCS.lastMessage.batRuns) + 'nb' + PCS.lastMessage.batRuns + 'r';
        PCS.lastMessage.graph = 'O';
      }
    } else if(PCS.lastMessage.batRuns==0) {
      PCS.lastMessage.delivery += '?b';
      PCS.lastMessage.graph = BALL_FACED_CHAR;// 'b';
    }
  }
  if(DEBUG_TO=='console') console.log(scoreType, scoreData, PCS); 
  if(scoreType!='RRQ' && scoreType!='RRR' && scoreType!='OVR') {
    PCS.lastMessage.scoreType = scoreType;
    PCS.lastMessage.scoreData = scoreData;
  }
  
  if(!processing) {
    processing = true; // debounce
    countDown(0);
  }
}

// synchronise match counters to PCS last score
function syncToPCS() {
  E.showPrompt("Synchronise with last PCS score?").
      then(function(confirmed) {
      if (confirmed) {
        Bangle.buzz();
        processing = true; //debounce to inhibit twist events
        wickets = PCS.wickets;
        counter = PCS.ball;
        PCS.previousBall = PCS.ball;
        PCS.previousRuns = PCS.runs;
        PCS.previousOnStrike = PCS.onStrike;
        PCS.previousBalls1Faced = PCS.balls1Faced;
        PCS.previousBalls2Faced = PCS.balls2Faced;
        PCS.previousBat1Runs = PCS.bat1Runs;
        PCS.previousBat2Runs = PCS.bat2Runs;
        PCS.previousWickets = PCS.wickets;

        over = PCS.over + 1;
        addLog((new Date()), over, counter, 
          "PCS Synced", PCS.overAndBall);
        resumeGame();
      } else {
        E.showPrompt();
        showMainMenu();
      }
   });
}

// main ball counter logic
// and in-play screen
function countDown(dir) {
  processing = true;
  battery = getBattery(); // refresh battery
  counter += dir;
  // suppress correction on first ball of innings
  if(over==1 && counter<0) {
    counter=0;
    processing = false;
    return;
  }
  // Suppress dir when play after time
  if(timeCalled)
    counter -= dir;
  // Correction to last ball of over
  if(counter<0) {
    counter = BALLS_PER_OVER -1;
    over -= 1;
    // use end of over time as last ball time
    ballTimes.push(overTimes.pop());
  }
  // create timestamp for log
  var timeSig = new Date();
  // calculate elapsed since last ball
  var lastBallTime = timeSig.getTime();
  if(ballTimes.length>0) {
    lastBallTime = ballTimes[ballTimes.length - 1];
  } else if(overTimes.length>0) {
    lastBallTime = overTimes[overTimes.length - 1];
  }
  var deadDuration = new Date(
    timeSig.getTime() - lastBallTime);
  // process new (dead) ball
  if(dir!=0) {
    // call play after time?
    if(timeCalled) {
      timeCalled = false;
      // resume heart rate monitoring
      if(HRM) Bangle.setHRMPower(1);
      // calculate time lost and log it
      var lastTimeTime = timeTimes[timeTimes.length - 1];
      var timeDuration = new Date(
        timeSig.getTime() - lastTimeTime);
      addLog(timeSig, over, counter, 
        "Play", /*LANG*/"Lost:" + formatDuration(timeDuration));    
    } else {
      if(counter>0) // reset elapsed time
        ballTimes.push(timeSig.getTime());
      Bangle.setLCDPower(1); //TODO need any more?
    
      if(dir>0) { // fairly delivered ball
        addLog(timeSig, over, counter, 
          "Ball", formatDuration(deadDuration));
      } else { // +1 ball still to come
        addLog(timeSig, over, counter, 
          /*LANG*/"Correction", formatDuration(deadDuration));
      }
    }
    // give haptic feedback
    if(counter == BALLS_PER_OVER - 2) {
      // buzz twice "2 to come"
      Bangle.buzz(400).then(()=>{
        return new Promise(
          resolve=>setTimeout(resolve,500));
      }).then(()=>{
        return Bangle.buzz(500);
      })
    } else if(counter == BALLS_PER_OVER - 1) {
      // long buzz "1 to come"
      Bangle.buzz(800);
    } else {
      // otherwise short buzz
      Bangle.buzz()
    }
    // Process end of over
    if (counter == BALLS_PER_OVER) {
      // calculate match time
      var matchDuration = new Date(
        timeSig.getTime() - overTimes[0]);
      var matchMinutesString = formatDuration(matchDuration);
      // calculate over time
      var overDuration = new Date(
        timeSig.getTime() - overTimes[overTimes.length - 1]);
      var overMinutesString = formatDuration(overDuration);  
      // log end of over
      addLog(timeSig, over + 1, 0, 
        /*LANG*/"Over Duration", overMinutesString);
      addLog(timeSig, over + 1, 0, 
        /*LANG*/"Innings Duration", matchMinutesString);
      overTimes.push(timeSig.getTime());
      // start new over
      over += 1;
      counter = 0; 
      ballTimes = [];
    }
  }
  // refresh in-play screen
  digitalWrite(LED1, 0); // off LED1
  g.clear(1);
  // draw wickets fallen (top-right)
  var wicketString = wickets;
  g.setFontAlign(1,0);
  g.setFont("Vector",26).
   drawString(wicketString, 162, 14, true);
  if(PCS.pairs==true) {
    g.setFont("Vector",12).
   drawString('P', 173, 15, true);
  } else {
    g.setFont("Vector",12).
   drawString('\¦\¦\¦', 173, 15, true);
  }
  // draw battery and heart rate (top-left)
  g.setFontAlign(-1,0);
  var headlineString = 'HR:' + heartRate;
  if(heartRateEventSeconds <= 0) headlineString = '';
  headlineString = battery + '% ' + headlineString;
  if(PCS.connected) {
    headlineString = PCS.score + ' ' + PCS.overAndBall;
    if(PCS.fieldingRuns>0) headlineString += ' (' + PCS.fieldingRuns + ')';
  }
  g.setFont("Vector",16).
    drawString(headlineString, 5, 11, true);
  // draw clock (upper-centre)
  g.setFontAlign(0,0);
  g.setFont("Vector",48).
    drawString(formatTimeOfDay(timeSig), 93, 55, true);
  // draw over.ball (centre)
  var ballString = (over-1) + "." + counter;
  if(over > OVERS_PER_INNINGS) 
    ballString = 'END';
  g.setFont("Vector",80).
    drawString(ballString, 93, 120, true);
  // draw ball graph and elapsed time
  var ballGraph = ''
  if(!PCS.connected) {
    BALL_FACED_CHAR.repeat(counter)
    + BALL_TO_COME_CHAR.repeat(BALLS_PER_OVER - counter);
    if(timeCalled) ballGraph = '-TIME-';
  } else {
    ballGraph =  
      PCS.lastMessage.delivery + ' '
      + PCS.overLog.join('')  //+ ' ' // + PCS.lastMessage.delivery; 
      + BALL_TO_COME_CHAR.repeat(BALLS_PER_OVER - PCS.ball);
  }
  
  g.setFont("Vector",18).drawString(
    ballGraph + ' ' + formatDuration(deadDuration), 93, 166, true);
  // return to wait for next input
  processing = false;
}

function resumeGame(play) {
  processing = true;
  Bangle.buzz();
  Bangle.setUI({
      mode: "custom",
      swipe: (directionLR, directionUD)=>{
        if (directionLR==-1) { 
          processing = true;
          showMainMenu();
        } else if (directionLR==1) { 
          processing = true;
          showLog();
        } else if (directionUD==-1) { 
          processing = true;
          countDown(1);
        } else {
          processing = true;
          countDown(-1);
        }
      },
      btn: ()=>{
        processing = true;
        countDown(1);
      }
    });
  if(over==0) { // at start of innings
    over += 1; // N.B. 1-based overs in code
    counter = 0; // balls
    ballTimes = [];
    // set an inital time for comparison  
    var timeSig = new Date();
    overTimes.push(timeSig.getTime());
    addLog(timeSig, over, counter, 
      "Play", "");        
  }
  // load in-play screen
  countDown(play? -1: 0);
}

function incrementWickets(inc) {
  processing = true;
  E.showPrompt(/*LANG*/"Amend wickets by " + inc + "?").
    then(function(confirmed) {
    if (confirmed) {
      Bangle.buzz();
      wickets += inc;
      var timeSig = new Date();
      if(inc>0) {
        countDown(1);
        addLog(timeSig, over, counter, 
          "Wicket", "Wickets: " + wickets);
      } else {
        addLog(timeSig, over, counter, 
          /*LANG*/"Recall Batter", "Wickets: " + wickets);
      }
      resumeGame();
    } else {
      E.showPrompt();
      showMainMenu();
    }
  });
}

function showMainMenu() {
  processing = true;
  Bangle.setUI();
  var scrollMenuItems = [];
  // add menu items
  if(over>0)
    scrollMenuItems.push("« Back");
  if(over==0 || timeCalled) 
    scrollMenuItems.push("Call Play");
  if(over>0 && !timeCalled) {
    scrollMenuItems.push("Wicket");
    if(wickets>0) 
      scrollMenuItems.push(/*LANG*/"Recall Batter");
    scrollMenuItems.push("Call Time");
    scrollMenuItems.push("New Innings");
    if(PCS.connected) 
      scrollMenuItems.push("PCS Sync");
    if(!HRM) 
      scrollMenuItems.push("Start HRM");
  }
  if(HRM) scrollMenuItems.push("Stop HRM");
  // show menu
  return E.showScroller({
    h: 80, c: scrollMenuItems.length,
    draw: (idx, r) => {
      g.setBgColor((idx&1)?"#000":"#121").clearRect(r.x,r.y,r.x+r.w-1,r.y+r.h-1);
      g.setFont("Vector", 30).drawString(scrollMenuItems[idx],r.x+10,r.y+28);
    },
    select: (idx) => {
      if(scrollMenuItems[idx]=="Call Time") {
        timeCalled = true;
        // power down HRM until play
        Bangle.setHRMPower(0);
        heartRateEventSeconds = 0;
        var timeSig = new Date();
        timeTimes.push(timeSig.getTime());
        addLog(timeSig, over, counter, 
               "Time", (HRM? "HRM Paused" : ""));        
        resumeGame();
      }
      if(scrollMenuItems[idx]=="Call Play") 
        resumeGame(timeCalled);
      if(scrollMenuItems[idx]=="« Back") 
        resumeGame();      
      if(scrollMenuItems[idx]=="Wicket") 
        incrementWickets(1);
      if(scrollMenuItems[idx]==/*LANG*/"Recall Batter") 
        incrementWickets(-1);
      if(scrollMenuItems[idx]=="New Innings") 
        newInnings();
      if(scrollMenuItems[idx]=="PCS Sync") 
        syncToPCS();
      if(scrollMenuItems[idx]=="Start HRM"
        || scrollMenuItems[idx]=="Stop HRM") {
        toggleHRM();
        resumeGame();
      }
    }
  });
}

function newInnings() {
  var timeSig = new Date();
  if(over!=0) { // new innings
    E.showPrompt(/*LANG*/"Start next innings?").
      then(function(confirmed) {
      if (confirmed) {
        Bangle.buzz();
        processing = true; //debounce to inhibit twist events
        wickets = 0;
        counter = 0;
        over = 0;
        ballTimes = [];
        overTimes = [];
        timeTimes = [];
        log = [];
        timeCalled = false;
        addLog(timeSig, OVERS_PER_INNINGS + 1, BALLS_PER_OVER, 
          "New Innings", require("locale").date(new Date(), 1));
        resumeGame();
      } else {
        E.showPrompt();
        showMainMenu();
      }
    });
  } else { // resume innings or start app
    addLog(timeSig, OVERS_PER_INNINGS + 1, BALLS_PER_OVER, 
      "New Innings", require("locale").date(new Date(), 1));
  }
}
// initialise file in storage
var file = require("Storage").open("matchlog.csv","a");
// save state on exit TODO WIP
E.on("kill", function() {
  if(DEBUG_TO=='console') console.log("Umpire app closed at " + (over-1) + "." + counter);
});
// set up twist refresh once only 
Bangle.on('twist', function() { 
  if(!processing) {
    processing = true; // debounce
    countDown(0);
  }
});
// set up HRM listener once only
Bangle.on('HRM', function(h) {
  updateHeartRate(h)});
newInnings(); // prepare 1st innings
showMainMenu(); // ready to play

NRF.disconnect(); // drop BLE connections to allow restart of BLE
NRF.setAdvertising({}, {
  name: "Umpire Ball Counter",
  showName: true,
  discoverable: true , // general discoverable, or limited - default is limited
  connectable: true,  // whether device is connectable - default is true
  scannable : true ,   // whether device can be scanned for scan response packets - default is true
  whenConnected : true ,// keep advertising when connected (nRF52 only)
  interval: 1000});
 // phy: "1mbps,coded"});

NRF.setServices({
  "5a0d6a15-b664-4304-8530-3a0ec53e5bc1" : {
    "df531f62-fc0b-40ce-81b2-32a6262ea440" : {
      value : ["BTS100/9"], 
      writable : true,
      onWrite : function(evt) {
          var typeA = new Uint8Array(evt.data, 0, 3);
          var dataA = new Uint8Array(evt.data, 3);
          if(DEBUG_TO=='screen') console.log(E.toString(typeA), E.toString(dataA));
          logPCS(E.toString(typeA), E.toString(dataA));
      }
    }
  }
});

NRF.on('connect', function(addr) {
  Bangle.buzz(1000);
  if(DEBUG_TO=='screen') console.log("BT Connected", addr);
});

NRF.on('disconnect', function(reason) {
  Bangle.buzz(1000);
  PCS.connected = false;
  addLog((new Date()), over, counter, "BT Disconnected", reason);
  if(DEBUG_TO=='screen') console.log("BT Disconnected", reason);
});
