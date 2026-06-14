// =============================================================================
// 智能NPC队友捕鱼游戏 — 完整版(性格+情绪+记忆+学习+进化)
// =============================================================================

// ==================== 配置参数 ====================
const CFG = {
    CANVAS_WIDTH: 900, CANVAS_HEIGHT: 520,
    FISH_TYPES: {
        small:{name:'小鱼',speed:[3.0,5.0],size:[22,32],score:10,body:'#4fc3f7',tail:'#0288d1'},
        medium:{name:'中鱼',speed:[1.8,3.2],size:[36,50],score:20,body:'#81c784',tail:'#2e7d32'},
        large:{name:'大鱼',speed:[0.8,1.8],size:[55,75],score:50,body:'#ffb74d',tail:'#e65100'},
        boss:{name:'Boss鱼',speed:[0.4,0.9],size:[80,110],score:100,body:'#ef5350',tail:'#b71c1c'}
    },
    SPAWN_INTERVALS:{small:{min:600,max:1400},medium:{min:1800,max:3500},large:{min:4000,max:7000},boss:{min:12000,max:22000}},
    MAX_FISH:15,BULLET_SPEED:12,BULLET_MAX_DIST:650,COMBO_WINDOW:2500,COMBO_MAX_MULT:3.0,
    ADAPT_INTERVAL:30000,ANALYSIS_WINDOW:12000,AGGRESSIVE_THRESHOLD:8,CASUAL_THRESHOLD:2,
    AI_BASE_INTERVAL:1600,AI_ACCURACY_BASE:0.65,AI_ACTIVITY_INIT:50,
    CHAT_COOLDOWNS:{hit:2000,combo:4000,boss:5000,idle:8000,ai_hit:3000},MAX_CHAT_MESSAGES:30
};

// ==================== 工具函数 ====================
function rand(min,max){return min+Math.random()*(max-min);}
function randInt(min,max){return Math.floor(rand(min,max+1));}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function dist(x1,y1,x2,y2){var dx=x2-x1,dy=y2-y1;return Math.sqrt(dx*dx+dy*dy);}
function calcPerformance(analyzer){var acc=analyzer.accuracy;var shots=analyzer.recentShots;if(shots===0)return 50;return Math.min(100,Math.floor(acc*60+shots*3));}

// ==================== 全局AI状态 ====================
var aiPersonality = {style:'active',friendliness:50,competitiveness:50,talkativeness:50,evolution:{exposureTime:0,moodShift:0,evolveTimer:0}};
var relationship = 50;
var aiEmotion = 'neutral';
var aiEmotionTimer = 0;
var aiMemory = {goodMoments:0,badMoments:0};
var trustLevel = 50;
var aiLearning = {likeCount:0,ignoreCount:0,dislikeCount:0};
var learningBias = 0;
var learnDecayTimer = 0;var aiLikesGiven = 0;var giftsReceived = 0;var giftTimer = 0;var giftActive = false;var giftEndTime = 0;var giftNotify = '';

// ==================== 鱼类 ====================
class Fish {
    constructor(type){
        var def=CFG.FISH_TYPES[type];this.type=type;this.size=rand(def.size[0],def.size[1]);
        this.speed=rand(def.speed[0],def.speed[1]);this.score=def.score;
        this.bodyColor=def.body;this.tailColor=def.tail;this.alive=true;this.entered=false;
        this.direction=Math.random()<0.5?1:-1;
        this.x=this.direction>0?-this.size:CFG.CANVAS_WIDTH+this.size;
        this.y=rand(this.size*1.5,CFG.CANVAS_HEIGHT-50-this.size);this.baseY=this.y;
        this.wobbleAmp=rand(0.3,1.2);this.wobbleFreq=rand(0.02,0.05);this.wobblePhase=rand(0,Math.PI*2);
        this.tailPhase=rand(0,Math.PI*2);
        if(type==='boss'){this.pulsePhase=rand(0,Math.PI*2);this.pulseSpeed=rand(2,4);}
    }
    update(){
        this.x+=this.speed*this.direction;this.y=this.baseY+Math.sin(this.wobblePhase)*this.wobbleAmp;
        this.wobblePhase+=this.wobbleFreq;this.tailPhase+=0.15;
        if(this.type==='boss')this.pulsePhase+=this.pulseSpeed*0.02;
        var m=this.size*2;if(this.x>m&&this.x<CFG.CANVAS_WIDTH-m)this.entered=true;
        if((this.direction>0&&this.x>CFG.CANVAS_WIDTH+m)||(this.direction<0&&this.x<-m))this.alive=false;
    }
    draw(ctx){
        ctx.save();ctx.translate(this.x,this.y);var dir=this.direction,hw=this.size*0.55,hh=this.size*0.35;
        if(this.type==='boss'){var g=0.3+0.2*Math.sin(this.pulsePhase);ctx.shadowColor=this.bodyColor;ctx.shadowBlur=15+g*15;}
        ctx.fillStyle=this.bodyColor;ctx.beginPath();ctx.ellipse(0,0,hw,hh,0,0,Math.PI*2);ctx.fill();
        ctx.fillStyle=this.tailColor;ctx.beginPath();var tx=-hw*dir,tt=tx-this.size*0.35*dir,ts=Math.sin(this.tailPhase)*3;
        ctx.moveTo(tx,-hh*0.6+ts);ctx.lineTo(tt,0);ctx.lineTo(tx,hh*0.6+ts);ctx.closePath();ctx.fill();
        if(this.size>35){ctx.fillStyle=this.tailColor;ctx.beginPath();ctx.moveTo(-hw*0.2,-hh);ctx.lineTo(hw*0.2,-hh-hh*0.5);ctx.lineTo(hw*0.5,-hh);ctx.closePath();ctx.fill();}
        var ex=hw*0.45*dir,ey=-hh*0.2;ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(ex,ey,this.size*0.12,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#111';ctx.beginPath();ctx.arc(ex+2*dir,ey,this.size*0.06,0,Math.PI*2);ctx.fill();ctx.restore();
    }
    hitTest(bx,by,br){return dist(bx,by,this.x,this.y)<(this.size*0.5+br);}
}

// ==================== 子弹类 ====================
class Bullet {
    constructor(x,y,tx,ty,owner){
        this.x=x;this.y=y;this.owner=owner;this.alive=true;this.distTraveled=0;
        var dx=tx-x,dy=ty-y,len=Math.sqrt(dx*dx+dy*dy)||1;
        this.vx=(dx/len)*CFG.BULLET_SPEED;this.vy=(dy/len)*CFG.BULLET_SPEED;
        this.radius=owner==='player'?4:3.5;this.color=owner==='player'?'#00e5ff':'#ff9800';
        this.glow=owner==='player'?'#00b8d4':'#f57c00';this.trail=[];
    }
    update(){
        if(this.trail.length>6)this.trail.shift();this.trail.push({x:this.x,y:this.y});
        this.x+=this.vx;this.y+=this.vy;this.distTraveled+=CFG.BULLET_SPEED;
        if(this.distTraveled>CFG.BULLET_MAX_DIST||this.x<-20||this.x>CFG.CANVAS_WIDTH+20||this.y<-20||this.y>CFG.CANVAS_HEIGHT+20)this.alive=false;
    }
    draw(ctx){
        for(var i=0;i<this.trail.length;i++){var p=this.trail[i];ctx.fillStyle=this.glow;ctx.globalAlpha=0.3;ctx.beginPath();ctx.arc(p.x,p.y,this.radius*0.7,0,Math.PI*2);ctx.fill();}
        ctx.globalAlpha=1;ctx.fillStyle=this.color;ctx.shadowColor=this.glow;ctx.shadowBlur=6;
        ctx.beginPath();ctx.arc(this.x,this.y,this.radius,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
        ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(this.x,this.y,this.radius*0.4,0,Math.PI*2);ctx.fill();
    }
}

// ==================== 粒子特效 ====================
class Particle {
    constructor(x,y,color){this.x=x;this.y=y;this.color=color;var a=rand(0,Math.PI*2),s=rand(1.5,5);this.vx=Math.cos(a)*s;this.vy=Math.sin(a)*s;this.life=1;this.decay=rand(0.015,0.04);this.size=rand(2,6);}
    update(){this.x+=this.vx;this.y+=this.vy;this.life-=this.decay;this.size*=0.98;return this.life>0;}
    draw(ctx){ctx.globalAlpha=this.life;ctx.fillStyle=this.color;ctx.beginPath();ctx.arc(this.x,this.y,this.size,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
}

// ==================== AI队友系统 ====================
class AITeammate {
    constructor(){this.fireInterval=CFG.AI_BASE_INTERVAL;this.accuracy=CFG.AI_ACCURACY_BASE;this.activity=CFG.AI_ACTIVITY_INIT;this.lastFireTime=0;this.fireX=CFG.CANVAS_WIDTH/2-50;this.fireY=CFG.CANVAS_HEIGHT-15;this.shotsFired=0;this.shotsHit=0;this.adaptTimer=0;this.currentTarget=null;this.status='active';}
    get statusLabel(){if(this.status==='active')return'活跃';if(this.status==='supportive')return'辅助';return'冷静';}
    get hitRate(){return this.shotsFired>0?(this.shotsHit/this.shotsFired*100).toFixed(0):0;}
    pickTarget(fishes){
        if(!fishes||fishes.length===0)return null;
        var alive=fishes.filter(function(f){return f.alive&&f.entered;});if(alive.length===0)return null;
        var styleBonus=aiPersonality.style==='leader'?3:1;
        var styleRand=aiPersonality.style==='funny'?30:aiPersonality.style==='leader'?5:15;
        var scored=alive.map(function(f){var p=f.score+rand(-styleRand,styleRand);if(f.type==='boss')p*=styleBonus;return{fish:f,priority:p};});
        scored.sort(function(a,b){return b.priority-a.priority;});
        var topChance=aiPersonality.style==='leader'?0.95:aiPersonality.style==='funny'?0.5:0.8;
        if(Math.random()<topChance)return scored[0].fish;return alive[randInt(0,alive.length-1)];
    }
    fireAt(target){
        if(!target)return null;var err=(1-this.accuracy)*rand(40,120);var a=rand(0,Math.PI*2);
        var tx=target.x+Math.cos(a)*err;var ty=target.y+Math.sin(a)*err;
        return new Bullet(this.fireX,this.fireY,tx,ty,'ai');
    }
    update(dt,fishes,bullets,playerAnalyzer,chatSystem){
        this.adaptTimer+=dt;if(this.adaptTimer>=CFG.ADAPT_INTERVAL){this.adaptTimer=0;this.adaptToPlayer(playerAnalyzer,chatSystem);}
        var now=performance.now();
        var compAdj=(typeof aiPersonality!=='undefined')?aiPersonality.competitiveness*0.002:0;
        var relAdj=relationship>70?-0.20:relationship<30?0.20:0;
        var trustAdj=trustLevel>70?-0.15:trustLevel<30?0.15:0;
        var emotionAdj=(aiEmotion==='excited'||aiEmotion==='happy')?-0.1:0;
        var learnAdj=learningBias>15?-0.1:learningBias<-15?0.12:0;
        var styleFireAdj=aiPersonality.style==='leader'?-0.15:aiPersonality.style==='active'?-0.1:aiPersonality.style==='calm'?0.15:0;
        if(learningBias>15){aiPersonality.talkativeness=clamp(aiPersonality.talkativeness+2,0,100);aiPersonality.friendliness=clamp(aiPersonality.friendliness+2,0,100);aiPersonality.competitiveness=clamp(aiPersonality.competitiveness+2,0,100);}
        if(learningBias<-15){aiPersonality.talkativeness=clamp(aiPersonality.talkativeness-2,0,100);aiPersonality.friendliness=clamp(aiPersonality.friendliness-2,0,100);}
        var effInterval=this.fireInterval*(1-compAdj+relAdj+trustAdj+emotionAdj+learnAdj+styleFireAdj);
        if(now-this.lastFireTime>=effInterval){var target=this.pickTarget(fishes);if(target){var bullet=this.fireAt(target);if(bullet){bullets.push(bullet);this.shotsFired++;this.lastFireTime=now;this.currentTarget=target;}}}
    }
    adaptToPlayer(playerAnalyzer,chatSystem){
        var pState=playerAnalyzer.state;var oldStatus=this.status;
        switch(pState){case'aggressive':this.activity=clamp(this.activity+8,0,100);this.status='active';break;case'casual':this.activity=clamp(this.activity-8,0,100);this.status='supportive';break;default:this.activity=clamp(this.activity+(50-this.activity)*0.3,0,100);this.status='active';break;}
        var pNorm=this.activity/100;this.fireInterval=CFG.AI_BASE_INTERVAL*(1.4-pNorm*0.9);this.accuracy=0.5+pNorm*0.3;
        if(this.status!==oldStatus&&chatSystem){var msgs={active:'状态不错，我火力全开！',supportive:'稳着来，我掩护你~',calm:'观察中，找准时机！'};chatSystem.addMessage(msgs[this.status],'system');}
    }
    tryAssist(fishes,bullets){var talkBonus=aiPersonality.talkativeness*0.002;if(Math.random()<0.30+this.activity*0.003+talkBonus){var target=this.pickTarget(fishes);if(target){var bullet=this.fireAt(target);if(bullet){bullets.push(bullet);this.shotsFired++;}}}}
    drawGun(ctx){ctx.fillStyle='#ff9800';ctx.shadowColor='#f57c00';ctx.shadowBlur=8;ctx.beginPath();ctx.arc(this.fireX,this.fireY,8,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#fff';ctx.font='9px "Microsoft YaHei"';ctx.textAlign='center';ctx.fillText('AI',this.fireX,this.fireY-14);}
}

// ==================== 聊天系统 ====================
class ChatSystem {
    constructor(){this.messages=[];this.cooldowns={};}
    canTrigger(event){var cd=CFG.CHAT_COOLDOWNS[event]||2000;var last=this.cooldowns[event]||0;return(performance.now()-last)>=cd;}
    trigger(event,context){
        if(!this.canTrigger(event))return;
        var templates=this.getTemplates(event);
        if(trustLevel>70&&aiEmotion==='happy'&&Math.random()<0.4){var closeMsgs=['我们越来越默契了！','这配合没谁了！','跟你打就是爽！','队友太靠谱了！'];this.addMessage(closeMsgs[randInt(0,closeMsgs.length-1)],'celebrate');}
        if(relationship<30&&Math.random()<0.3&&(event==='hit'||event==='idle'||event==='miss_streak')){var encourage=['一起加油！','我们配合会更好的~','多打几发试试？','相信你！'];this.addMessage(encourage[randInt(0,encourage.length-1)],'encourage');}
        var emotionKey=aiEmotion+'_chat';var emotionTpl=this.getTemplates(emotionKey);if(emotionTpl&&emotionTpl.length>0&&Math.random()<0.4){templates=emotionTpl;}
        if(typeof aiPersonality!=='undefined'){var styleKey=aiPersonality.style+'_'+event;var styleTpl=this.getTemplates(styleKey);if(styleTpl&&styleTpl.length>0&&Math.random()<0.6){templates=styleTpl;}}
        if(!templates||templates.length===0)return;var msg=templates[randInt(0,templates.length-1)];var type=this.getMsgType(event);this.addMessage(msg,type);this.cooldowns[event]=performance.now();
    }
    addMessage(text,type){this.messages.push({text:text,type:type,time:performance.now(),fading:false});if(this.messages.length>CFG.MAX_CHAT_MESSAGES)this.messages.shift();if(this.messages.length>15){for(var i=0;i<this.messages.length-10;i++)this.messages[i].fading=true;}this.render();}
    getTemplates(event){
        var t={
            hit:['漂亮！','打得好！','Nice!','继续加油！','这一发不错！','好枪法！','漂亮一击！','命中目标！'],
            combo:['连击！太强了！','手感火热啊！','这波操作满分！','停不下来！','连续命中，厉害！','火力全开！'],
            boss_kill:['Boss倒了！牛啊！','大块头也顶不住！','配合太默契了！','Boss击杀！完美！','干得漂亮！Boss没了！'],
            miss_streak:['别急，稳一点~','下一发肯定中！','调整一下节奏？','差一点点，再试试！','放松，找找感觉~'],
            idle:['在发呆吗？','来一发试试？','鱼在那边呢~','休息好了就开打！','我掩护，你上！'],
            ai_hit:['我也来一发！','补刀成功！','配合很强！','交给我！','击中了！','队友在此！'],
            ai_miss:['哎呀偏了！','差一点！','下一发必中！'],assist:['补刀来啦！','跟上你的节奏！','一起上！'],
            welcome:['准备好了吗？开战！','一起捕鱼吧！','并肩作战！'],
            funny_hit:['啊哈，打中了！','鱼：我谢谢你啊~','这鱼懵了吧？','精准投喂！'],
            funny_combo:['连击如喝水！','你是捕鱼达人吧？','鱼群：快跑！'],
            funny_idle:['鱼都笑你了~','再不射鱼要跑了！'],
            leader_hit:['不错，继续推进！','有效打击！','就这样，跟上我！'],
            leader_boss_kill:['战术成功！','收到，Boss已清除！'],
            leader_idle:['大鱼在那边，上！','注意左侧鱼群！'],
            calm_hit:['稳扎稳打，很好。','节奏不错，保持住~'],
            calm_miss_streak:['慢慢来，不着急~','平静就是力量~','你找到感觉了！'],
            happy_chat:['今天手感真好！','爽！','这波太舒服了！'],
            excited_chat:['Boss来了！集中火力！','大块头出现了！'],
            annoyed_chat:['啧，运气差了点。','别急，调整一下。'],
            proud_chat:['漂亮！我们配合完美！','这才是团队！']
        };return t[event]||[];
    }
    getMsgType(event){var m={hit:'normal',combo:'celebrate',boss_kill:'celebrate',miss_streak:'encourage',idle:'tease',ai_hit:'normal',ai_miss:'tease',assist:'normal',welcome:'normal',system:'system',funny_hit:'normal',funny_combo:'celebrate',leader_hit:'normal',leader_boss_kill:'celebrate',leader_idle:'normal',calm_hit:'normal',calm_miss_streak:'encourage',happy_chat:'celebrate',excited_chat:'celebrate',annoyed_chat:'tease',proud_chat:'celebrate'};return m[event]||'normal';}
    render(){var container=document.getElementById('chat-messages');if(!container)return;container.innerHTML='';for(var i=0;i<this.messages.length;i++){var msg=this.messages[i];var div=document.createElement('div');div.className='chat-message '+msg.type+(msg.fading?' fading':'');div.textContent=msg.text;container.appendChild(div);}container.scrollTop=container.scrollHeight;}
}

// ==================== 玩家行为分析器 ====================
class PlayerAnalyzer {
    constructor(){this.shotTimestamps=[];this.hitTimestamps=[];}
    recordShot(){this.shotTimestamps.push(performance.now());this.prune();}
    recordHit(){this.hitTimestamps.push(performance.now());this.prune();}
    prune(){var cutoff=performance.now()-CFG.ANALYSIS_WINDOW;this.shotTimestamps=this.shotTimestamps.filter(function(t){return t>cutoff;});this.hitTimestamps=this.hitTimestamps.filter(function(t){return t>cutoff;});}
    get recentShots(){this.prune();return this.shotTimestamps.length;}
    get recentHits(){this.prune();return this.hitTimestamps.length;}
    get accuracy(){this.prune();if(this.shotTimestamps.length===0)return 0;return this.hitTimestamps.length/this.shotTimestamps.length;}
    get state(){this.prune();var shots=this.shotTimestamps.length;var hits=this.hitTimestamps.length;var acc=shots>0?hits/shots:0;if(shots>=CFG.AGGRESSIVE_THRESHOLD&&acc>=0.2)return'aggressive';if(shots<=CFG.CASUAL_THRESHOLD)return'casual';return'balanced';}
    get stateLabel(){var map={aggressive:'激进',balanced:'平衡',casual:'休闲'};return map[this.state]||'平衡';}
}

// ==================== 背景气泡 ====================
class Bubbles {
    constructor(){this.bubbles=[];this.timer=0;}
    update(){this.timer++;if(this.timer%20===0&&this.bubbles.length<25){this.bubbles.push({x:rand(0,CFG.CANVAS_WIDTH),y:CFG.CANVAS_HEIGHT+10,size:rand(2,6),speed:rand(0.3,1.2),opacity:rand(0.15,0.4)});}for(var i=0;i<this.bubbles.length;i++){var b=this.bubbles[i];b.y-=b.speed;b.x+=Math.sin(b.y*0.02)*0.3;}this.bubbles=this.bubbles.filter(function(b){return b.y>-20;});}
    draw(ctx){for(var i=0;i<this.bubbles.length;i++){var b=this.bubbles[i];ctx.strokeStyle='rgba(150,200,255,'+b.opacity+')';ctx.lineWidth=1;ctx.beginPath();ctx.arc(b.x,b.y,b.size,0,Math.PI*2);ctx.stroke();ctx.fillStyle='rgba(255,255,255,'+(b.opacity*0.6)+')';ctx.beginPath();ctx.arc(b.x-b.size*0.3,b.y-b.size*0.3,b.size*0.25,0,Math.PI*2);ctx.fill();}}
}

// ==================== 主游戏引擎 ====================
class Game {
    constructor(){
        this.canvas=document.getElementById('game-canvas');this.ctx=this.canvas.getContext('2d');
        this.fishes=[];this.bullets=[];this.particles=[];this.score=0;this.combo=0;this.lastHitTime=0;
        this.playerKills=0;this.aiKills=0;this.bossKills=0;this.gameTime=0;this.lastFrameTime=0;
        this.paused=false;this.idleTimer=0;this.lastPlayerShot=0;this.missStreak=0;
        this.lastPlayerHitTime=0;this.lastAiHitTime=0;this.consecutiveHits=0;this.lastScoreValue=0;
        this.smallFishStreak=0;this.bossBulletsFired=0;this.playerMissCount=0;this.lastRelScoreTime=0;
        this.ai=new AITeammate();this.chat=new ChatSystem();this.analyzer=new PlayerAnalyzer();this.bubbles=new Bubbles();
        this.spawnTimers={};var self=this;Object.keys(CFG.SPAWN_INTERVALS).forEach(function(type){self.spawnTimers[type]=0;self.resetSpawnTimer(type);});
        this.init();
    }
    init(){this.canvas.width=CFG.CANVAS_WIDTH;this.canvas.height=CFG.CANVAS_HEIGHT;var self=this;this.canvas.addEventListener('click',function(e){self.handleClick(e);});for(var i=0;i<5;i++)this.spawnFish('small');for(var i=0;i<2;i++)this.spawnFish('medium');this.spawnFish('large');setTimeout(function(){self.chat.trigger('welcome',{});},500);}
    resetSpawnTimer(type){var range=CFG.SPAWN_INTERVALS[type];this.spawnTimers[type]=rand(range.min,range.max);}
    start(){this.lastFrameTime=performance.now();var self=this;requestAnimationFrame(function(t){self.loop(t);});}
    loop(timestamp){
        if(this.paused)return;try{
        var dt=timestamp-this.lastFrameTime;this.lastFrameTime=timestamp;this.gameTime+=dt;this.idleTimer+=dt;
        aiEmotionTimer+=dt;if(aiEmotionTimer>8000&&aiEmotion!=='neutral'){aiEmotion='neutral';aiEmotionTimer=0;}
        learnDecayTimer+=dt;if(learnDecayTimer>60000){learningBias*=0.98;learnDecayTimer=0;}giftTimer+=dt;if(giftTimer>90000+rand(0,60000)&&relationship>30){giftTimer=0;giftActive=true;giftEndTime=this.gameTime+15000;giftNotify='AI送你礼物！15秒双倍积分！';if(this.chat)this.chat.addMessage(giftNotify,'celebrate');giftsReceived++;}if(giftActive&&this.gameTime>giftEndTime){giftActive=false;giftNotify='';}
        aiPersonality.evolution.evolveTimer+=dt;
        if(aiPersonality.evolution.evolveTimer>30000){aiPersonality.evolution.evolveTimer=0;aiPersonality.evolution.exposureTime++;
            var perf=calcPerformance(this.analyzer);if(perf>70)aiPersonality.evolution.moodShift=clamp(aiPersonality.evolution.moodShift+1,-10,10);
            else if(perf<30)aiPersonality.evolution.moodShift=clamp(aiPersonality.evolution.moodShift-1,-10,10);
            var ms=aiPersonality.evolution.moodShift;if(ms>5)aiPersonality.style='leader';else if(ms>2)aiPersonality.style='active';else if(ms<-2)aiPersonality.style='calm';else aiPersonality.style='funny';}
        if(this.lastRelScoreTime===0)this.lastRelScoreTime=this.gameTime;if(this.gameTime-this.lastRelScoreTime>60000){relationship=Math.max(0,relationship-5);this.lastRelScoreTime=this.gameTime;}
        this.update(dt);this.draw();this.updateUI();}catch(e){console.error('[Game] Loop error:',e.message);}
        var self=this;requestAnimationFrame(function(t){self.loop(t);});
    }
    update(dt){
        var self=this;Object.keys(CFG.SPAWN_INTERVALS).forEach(function(type){self.spawnTimers[type]-=dt;if(self.spawnTimers[type]<=0){self.resetSpawnTimer(type);if(self.fishes.filter(function(f){return f.alive;}).length<CFG.MAX_FISH){self.spawnFish(type);}}});
        for(var i=0;i<this.fishes.length;i++){if(this.fishes[i].alive)this.fishes[i].update();}this.fishes=this.fishes.filter(function(f){return f.alive;});
        for(var i=0;i<this.bullets.length;i++){if(this.bullets[i].alive)this.bullets[i].update();}
        this.ai.update(dt,this.fishes,this.bullets,this.analyzer,this.chat);this.checkCollisions();
        var deadPlayerBullets=this.bullets.filter(function(b){return!b.alive&&b.owner==='player';});
        if(deadPlayerBullets.length>0){this.playerMissCount+=deadPlayerBullets.length;relationship=Math.max(0,relationship-deadPlayerBullets.length);if(this.playerMissCount>=3){relationship=Math.max(0,relationship-2);this.playerMissCount=0;}}
        this.bullets=this.bullets.filter(function(b){return b.alive;});this.particles=this.particles.filter(function(p){return p.update();});this.bubbles.update();
        if(this.bossBulletsFired>=5){var bossAlive=this.fishes.some(function(f){return f.alive&&f.type==='boss';});if(!bossAlive){relationship=Math.max(0,relationship-Math.min(10,this.bossBulletsFired));this.bossBulletsFired=0;}}
        if(this.idleTimer>12000&&this.chat.canTrigger('idle')){this.chat.trigger('idle',{});this.idleTimer=0;relationship=Math.max(0,relationship-2);}
        if(this.combo>0&&performance.now()-this.lastHitTime>CFG.COMBO_WINDOW){this.combo=0;}
        if(this.missStreak>=5&&this.chat.canTrigger('miss_streak')){this.chat.trigger('miss_streak',{});this.missStreak=0;relationship=Math.max(0,relationship-3);aiEmotion='annoyed';aiEmotionTimer=0;aiMemory.badMoments++;trustLevel=clamp(50+aiMemory.goodMoments*3-aiMemory.badMoments*4,0,100);}
    }
    spawnFish(type){this.fishes.push(new Fish(type));if(type==='boss'){aiEmotion='excited';aiEmotionTimer=0;}}
    handleClick(e){
        var rect=this.canvas.getBoundingClientRect();var sx=CFG.CANVAS_WIDTH/rect.width;var sy=CFG.CANVAS_HEIGHT/rect.height;
        var cx=(e.clientX-rect.left)*sx;var cy=(e.clientY-rect.top)*sy;var px=CFG.CANVAS_WIDTH/2+15;var py=CFG.CANVAS_HEIGHT-20;
        this.bullets.push(new Bullet(px,py,cx,cy,'player'));this.analyzer.recordShot();this.idleTimer=0;this.lastPlayerShot=performance.now();
        for(var fi=0;fi<this.fishes.length;fi++){var f=this.fishes[fi];if(f.alive&&f.type==='boss'&&dist(cx,cy,f.x,f.y)<f.size*1.5){this.bossBulletsFired++;break;}}
        this.ai.tryAssist(this.fishes,this.bullets);
    }
    checkCollisions(){for(var bi=0;bi<this.bullets.length;bi++){var bullet=this.bullets[bi];if(!bullet.alive)continue;for(var fi=0;fi<this.fishes.length;fi++){var fish=this.fishes[fi];if(!fish.alive)continue;if(fish.hitTest(bullet.x,bullet.y,bullet.radius)){bullet.alive=false;fish.alive=false;this.handleFishHit(fish,bullet);break;}}}}
    handleFishHit(fish,bullet){
        var isPlayer=bullet.owner==='player';var mult=Math.min(1+this.combo*0.15,CFG.COMBO_MAX_MULT);var pts=Math.floor(fish.score*mult*(giftActive?2:1));
        if(isPlayer){this.score+=pts;this.lastRelScoreTime=this.gameTime;this.playerKills++;this.missStreak=0;this.lastPlayerHitTime=performance.now();this.playerMissCount=0;aiEmotion='happy';aiEmotionTimer=0;
            this.consecutiveHits++;var relBonus=this.consecutiveHits<=3?2:this.consecutiveHits<=6?1:0.5;relationship=Math.min(100,relationship+relBonus);
            if(fish.type==='small'){this.smallFishStreak++;if(this.smallFishStreak>3){relationship=Math.max(0,relationship-Math.min(3,this.smallFishStreak-3));}}else{this.smallFishStreak=0;}
            if(fish.type==='boss'){relationship=Math.min(100,relationship+5);aiMemory.goodMoments++;trustLevel=clamp(50+aiMemory.goodMoments*3-aiMemory.badMoments*4,0,100);this.bossBulletsFired=0;}
            if(this.lastAiHitTime>0&&(this.lastPlayerHitTime-this.lastAiHitTime)<1000){relationship=Math.min(100,relationship+5);aiEmotion='proud';aiEmotionTimer=0;aiMemory.goodMoments++;}
            var now=performance.now();if(now-this.lastHitTime<CFG.COMBO_WINDOW)this.combo++;else this.combo=1;if(this.combo>=5){aiMemory.goodMoments++;trustLevel=clamp(50+aiMemory.goodMoments*3-aiMemory.badMoments*4,0,100);aiLikesGiven++;}this.lastHitTime=now;this.analyzer.recordHit();
            if(fish.type==='boss'){this.bossKills++;this.chat.trigger('boss_kill',{type:fish.type});aiLikesGiven++;}else if(this.combo>=3){this.chat.trigger('combo',{combo:this.combo});}else{this.chat.trigger('hit',{type:fish.type});}
        }else{this.score+=fish.score;this.aiKills++;this.ai.shotsHit++;if(fish.type==='boss')this.bossKills++;this.lastAiHitTime=performance.now();relationship=Math.min(100,relationship+2);if(this.lastPlayerHitTime>0&&(this.lastAiHitTime-this.lastPlayerHitTime)<1000){relationship=Math.min(100,relationship+5);}this.chat.trigger('ai_hit',{type:fish.type});}
        for(var i=0;i<12;i++){this.particles.push(new Particle(fish.x,fish.y,fish.bodyColor));}
    }
    draw(){
        var ctx=this.ctx;ctx.clearRect(0,0,CFG.CANVAS_WIDTH,CFG.CANVAS_HEIGHT);this.drawBackground(ctx);this.bubbles.draw(ctx);
        for(var i=0;i<this.fishes.length;i++){if(this.fishes[i].alive)this.fishes[i].draw(ctx);}
        for(var i=0;i<this.bullets.length;i++){if(this.bullets[i].alive)this.bullets[i].draw(ctx);}
        for(var i=0;i<this.particles.length;i++){this.particles[i].draw(ctx);}this.ai.drawGun(ctx);this.drawPlayerGun(ctx);if(giftActive){ctx.fillStyle='#ffd700';ctx.font='bold 18px sans-serif';ctx.textAlign='center';var alpha=0.5+0.5*Math.sin(this.gameTime*0.005);ctx.globalAlpha=alpha;ctx.fillText('🎁 双倍积分!',CFG.CANVAS_WIDTH/2,CFG.CANVAS_HEIGHT-60);ctx.globalAlpha=1;}
        ctx.strokeStyle='rgba(100,180,255,0.3)';ctx.lineWidth=2;ctx.setLineDash([15,8]);ctx.beginPath();ctx.moveTo(0,8);ctx.lineTo(CFG.CANVAS_WIDTH,8);ctx.stroke();ctx.setLineDash([]);
    }
    drawBackground(ctx){
        var grad=ctx.createLinearGradient(0,0,0,CFG.CANVAS_HEIGHT);grad.addColorStop(0,'#0a1a3a');grad.addColorStop(0.5,'#0d2847');grad.addColorStop(1,'#061220');ctx.fillStyle=grad;ctx.fillRect(0,0,CFG.CANVAS_WIDTH,CFG.CANVAS_HEIGHT);
        ctx.fillStyle='#1a2a1a';ctx.beginPath();ctx.moveTo(0,CFG.CANVAS_HEIGHT);for(var x=0;x<=CFG.CANVAS_WIDTH;x+=40){ctx.lineTo(x,CFG.CANVAS_HEIGHT-20-Math.sin(x*0.02)*10);}ctx.lineTo(CFG.CANVAS_WIDTH,CFG.CANVAS_HEIGHT);ctx.closePath();ctx.fill();
        ctx.strokeStyle='#1a4a2a';ctx.lineWidth=3;for(var i=0;i<6;i++){var sx=80+i*150+rand(-20,20);ctx.beginPath();ctx.moveTo(sx,CFG.CANVAS_HEIGHT-25);ctx.quadraticCurveTo(sx-15,CFG.CANVAS_HEIGHT-60-i*5,sx+10,CFG.CANVAS_HEIGHT-85-i*8);ctx.stroke();ctx.beginPath();ctx.moveTo(sx+10,CFG.CANVAS_HEIGHT-25);ctx.quadraticCurveTo(sx+20,CFG.CANVAS_HEIGHT-55-i*4,sx-5,CFG.CANVAS_HEIGHT-70-i*6);ctx.stroke();}
    }
    drawPlayerGun(ctx){var px=CFG.CANVAS_WIDTH/2+15;var py=CFG.CANVAS_HEIGHT-20;ctx.fillStyle='#00e5ff';ctx.shadowColor='#00b8d4';ctx.shadowBlur=8;ctx.beginPath();ctx.arc(px,py,8,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#fff';ctx.font='9px "Microsoft YaHei"';ctx.textAlign='center';ctx.fillText('我',px,py-14);}
    updateUI(){
        document.getElementById('score-display').textContent=this.score;document.getElementById('combo-display').textContent='x'+this.combo;document.getElementById('combo-display').style.color=this.combo>=3?'#fbbf24':'#e2e8f0';
        var mins=Math.floor(this.gameTime/60000);var secs=Math.floor((this.gameTime%60000)/1000);document.getElementById('time-display').textContent=String(mins).padStart(2,'0')+':'+String(secs).padStart(2,'0');
        var pEl=document.getElementById('player-status');pEl.textContent=this.analyzer.stateLabel;pEl.className='value status-'+this.analyzer.state;
        var aEl=document.getElementById('ai-status');aEl.textContent=this.ai.statusLabel;aEl.className='value status-'+this.ai.status;
        var emoEl=document.getElementById('emotion-display');if(emoEl){var m={happy:'😊开心',excited:'🤩兴奋',annoyed:'😤不爽',proud:'😎自豪',neutral:'😐平静'};emoEl.textContent=m[aiEmotion]||'😐平静';}
        var trustEl=document.getElementById('trust-display');if(trustEl){trustEl.textContent='信任'+trustLevel;trustEl.style.color=trustLevel>70?'#4ade80':trustLevel<30?'#f87171':'#fbbf24';}
        var relEl=document.getElementById('relationship-display');if(relEl){var relLabel=relationship>=90?'默契伙伴':relationship>=70?'好搭档':relationship>=30?'队友':'陌生';var relColor=relationship>=70?'#4ade80':relationship>=30?'#fbbf24':'#f87171';relEl.textContent=relLabel+'('+relationship+')';relEl.style.color=relColor;}
        document.getElementById('stat-player-accuracy').textContent=(this.analyzer.accuracy*100).toFixed(0)+'%';document.getElementById('stat-ai-accuracy').textContent=this.ai.hitRate+'%';
        document.getElementById('stat-player-kills').textContent=this.playerKills;document.getElementById('stat-ai-kills').textContent=this.aiKills;document.getElementById('stat-boss-kills').textContent=this.bossKills;
        var lbEl=document.getElementById('learning-bias');if(lbEl){lbEl.textContent=learningBias.toFixed(1);lbEl.style.color=learningBias>5?'#4ade80':learningBias<-5?'#f87171':'#94a3b8';}
        var evEl=document.getElementById('evolve-style');if(evEl){var sl={active:'⚡活跃',calm:'🧘冷静',funny:'😄幽默',leader:'🎯领袖'};evEl.textContent=sl[aiPersonality.style]||aiPersonality.style;}
        var msEl=document.getElementById('evolve-mood');if(msEl){msEl.textContent=(aiPersonality.evolution.moodShift>0?'+':'')+aiPersonality.evolution.moodShift;msEl.style.color=aiPersonality.evolution.moodShift>2?'#4ade80':aiPersonality.evolution.moodShift<-2?'#f87171':'#94a3b8';}
        var etEl=document.getElementById('evolve-time');if(etEl)etEl.textContent=aiPersonality.evolution.exposureTime+'轮';
        var llEl=document.getElementById('learning-likes');if(llEl)llEl.textContent=aiLearning.likeCount;
        var liEl=document.getElementById('learning-ignores');if(liEl)liEl.textContent=aiLearning.ignoreCount;
        var ldEl=document.getElementById('learning-dislikes');if(ldEl)ldEl.textContent=aiLearning.dislikeCount;var alEl=document.getElementById('ai-likes-given');if(alEl)alEl.textContent=aiLikesGiven;var gfEl=document.getElementById('gifts-received');if(gfEl)gfEl.textContent=giftsReceived;
    }
}

// ==================== 启动游戏 ====================
window.addEventListener('DOMContentLoaded',function(){
    var likeBtn=document.getElementById('btn-like');var ignoreBtn=document.getElementById('btn-ignore');var dislikeBtn=document.getElementById('btn-dislike');
    if(likeBtn)likeBtn.onclick=function(){aiLearning.likeCount++;learningBias=aiLearning.likeCount*2-aiLearning.dislikeCount*3-aiLearning.ignoreCount;};
    if(ignoreBtn)ignoreBtn.onclick=function(){aiLearning.ignoreCount++;learningBias=aiLearning.likeCount*2-aiLearning.dislikeCount*3-aiLearning.ignoreCount;};
    if(dislikeBtn)dislikeBtn.onclick=function(){aiLearning.dislikeCount++;learningBias=aiLearning.likeCount*2-aiLearning.dislikeCount*3-aiLearning.ignoreCount;};
    try{var game=new Game();game.start();}catch(e){console.error('[Game] Init error:',e);var d=document.createElement('div');d.style.cssText='position:fixed;top:10px;left:10px;background:#c62828;color:#fff;padding:12px 16px;z-index:99999;font:13px monospace;border-radius:6px;max-width:90%';d.innerHTML='<b>游戏启动失败</b><br>'+e.message;document.body.appendChild(d);}
});
