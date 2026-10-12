// Adapted from Keduoli03/animatedlogin-react (MIT). See THIRD-PARTY-NOTICES.md.
import React, { useEffect, useRef, useState } from "react";
import "./AnimatedCharacters.css";

const REDUCE_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 瞳孔偏移：朝鼠标方向移动，但不超过 maxDistance */
function lookAt(rect, mouseX, mouseY, maxDistance) {
  const deltaX = mouseX - (rect.left + rect.width / 2);
  const deltaY = mouseY - (rect.top + rect.height / 2);
  const distance = Math.min(Math.sqrt(deltaX ** 2 + deltaY ** 2), maxDistance);
  const angle = Math.atan2(deltaY, deltaX);
  return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
}

/** 纯瞳孔，没有眼白（橙色和黄色角色用，它们体积小、底色亮，画眼白会显脏） */
function Pupil({
  mouseX,
  mouseY,
  size = 12,
  maxDistance = 5,
  pupilColor = "#2D2D2D",
  forceLookX,
  forceLookY,
}) {
  const pupilRef = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (forceLookX !== undefined && forceLookY !== undefined) {
      setPos({ x: forceLookX, y: forceLookY });
      return;
    }
    if (!pupilRef.current) return;
    setPos(lookAt(pupilRef.current.getBoundingClientRect(), mouseX, mouseY, maxDistance));
  }, [mouseX, mouseY, forceLookX, forceLookY, maxDistance]);

  return (
    <div
      ref={pupilRef}
      className="ac-pupil"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: pupilColor,
        transform: `translate(${pos.x}px, ${pos.y}px)`,
      }}
    />
  );
}

/**
 * 带眼白的眼球（紫色和黑色角色用）
 *
 * 给了 forceLookX/forceLookY 就固定朝那个方向看，用来做「对视」「回避」「偷看」。
 * isSad 把整只眼压扁成半圆并旋转；左右眼传相反的 sadRotate，合起来才是垂眼。
 */
function EyeBall({
  mouseX,
  mouseY,
  size = 18,
  pupilSize = 7,
  maxDistance = 5,
  eyeColor = "#fff",
  pupilColor = "#2D2D2D",
  isBlinking = false,
  forceLookX,
  forceLookY,
  isSad = false,
  sadRotate = 0,
}) {
  const eyeRef = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (forceLookX !== undefined && forceLookY !== undefined) {
      setPos({ x: forceLookX, y: forceLookY });
      return;
    }
    if (!eyeRef.current) return;
    // 每次都实测：角色身体在倾斜变形，眼睛的屏幕位置一直在变，缓存会错位
    setPos(lookAt(eyeRef.current.getBoundingClientRect(), mouseX, mouseY, maxDistance));
  }, [mouseX, mouseY, forceLookX, forceLookY, maxDistance]);

  return (
    <div
      ref={eyeRef}
      className="ac-eyeball"
      style={{
        width: `${size}px`,
        height: isBlinking ? "2px" : isSad ? `${size * 0.5}px` : `${size}px`,
        backgroundColor: eyeColor,
        borderRadius: isSad ? `0 0 ${size}px ${size}px` : "50%",
        transform: isSad ? `rotate(${sadRotate}deg)` : "rotate(0deg)",
      }}
    >
      {!isBlinking && (
        <div
          className="ac-pupil"
          style={{
            width: `${pupilSize}px`,
            height: `${pupilSize}px`,
            backgroundColor: pupilColor,
            transform: `translate(${pos.x}px, ${isSad ? -1 : pos.y}px)`,
          }}
        />
      )}
    </div>
  );
}

/** 随机眨眼，间隔 3–7 秒。只有紫色和黑色眨眼，橙黄没有眼白看不出来 */
function useBlink() {
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    if (REDUCE_MOTION) return undefined;
    let openTimer;
    let closeTimer;
    const schedule = () => {
      openTimer = setTimeout(() => {
        setBlinking(true);
        closeTimer = setTimeout(() => {
          setBlinking(false);
          schedule();
        }, 150);
      }, Math.random() * 4000 + 3000);
    };
    schedule();
    return () => {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
    };
  }, []);

  return blinking;
}

const ORIGIN = { faceX: 0, faceY: 0, bodySkew: 0 };

function calculatePosition(el, mouseX, mouseY) {
  if (!el) return ORIGIN;
  const rect = el.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  // 取高度的 1/3：脸在上半部分，用几何中心视线会偏低
  const centerY = rect.top + rect.height / 3;
  const deltaX = mouseX - centerX;
  const deltaY = mouseY - centerY;
  return {
    faceX: Math.max(-15, Math.min(15, deltaX / 20)),
    faceY: Math.max(-10, Math.min(10, deltaY / 30)),
    bodySkew: Math.max(-6, Math.min(6, -deltaX / 120)),
  };
}

/**
 * 嘴跟着眼睛走：水平居中对齐眼睛那一块，垂直往下挪一个固定距离。
 * 这样只要调眼睛坐标，嘴自动跟上，不会出现「眼睛动了嘴没动」。
 */
function faceLayout(eyeX, eyeY, eyesWidth, mouthWidth, mouthDrop) {
  return {
    eyeX,
    eyeY,
    mouthX: eyeX + (eyesWidth - mouthWidth) / 2,
    mouthY: eyeY + mouthDrop,
  };
}

/**
 * 四个动画角色
 *
 * 四种姿态（优先级从高到低）：
 *   isPeeping             密码已填且明文 → 都凑过去偷看，紫色还会不时瞄一眼
 *   isLookingAway         密码框聚焦且密文 → 集体转头回避，黑色隔几秒往右瞟一眼
 *   isLookingAtEachOther  账号框聚焦的头 0.8 秒 → 紫色和黑色对视
 *   默认                   眼睛和身体跟随鼠标
 *
 * 另外 loginFailed 会摇头 + 垮脸，loginSuccess 会咧嘴。
 */
export default function AnimatedCharacters({
  isTyping = false,
  isPasswordFocused = false,
  showPassword = false,
  passwordLength = 0,
  loginFailed = false,
  loginSuccess = false,
}) {
  const purpleRef = useRef(null);
  const blackRef = useRef(null);
  const orangeRef = useRef(null);
  const yellowRef = useRef(null);

  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [purplePos, setPurplePos] = useState(ORIGIN);
  const [blackPos, setBlackPos] = useState(ORIGIN);
  const [orangePos, setOrangePos] = useState(ORIGIN);
  const [yellowPos, setYellowPos] = useState(ORIGIN);

  const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false);
  const [isPurplePeeking, setIsPurplePeeking] = useState(false);
  const [isBlackPeeking, setIsBlackPeeking] = useState(false);
  /** 0 = 不摇，1/2 = 交替使用的两个动画槽 */
  const [shakeSlot, setShakeSlot] = useState(0);

  const purpleBlinking = useBlink();
  const blackBlinking = useBlink();

  const isHidingPassword = passwordLength > 0 && !showPassword;
  const isPeeping = passwordLength > 0 && showPassword;
  const isLookingAway = isPasswordFocused && !showPassword;

  /* ---------- 鼠标跟随（RAF 节流） ---------- */

  useEffect(() => {
    if (REDUCE_MOTION) return undefined;

    let rafId = null;
    let pendingX = 0;
    let pendingY = 0;
    let needsUpdate = false;

    // mousemove 一秒能来几百次，直接 setState 会把 React 压垮；一帧算一次就够
    const handleMouseMove = (e) => {
      pendingX = e.clientX;
      pendingY = e.clientY;
      needsUpdate = true;
    };

    const tick = () => {
      if (needsUpdate) {
        needsUpdate = false;
        setMouse({ x: pendingX, y: pendingY });
        setPurplePos(calculatePosition(purpleRef.current, pendingX, pendingY));
        setBlackPos(calculatePosition(blackRef.current, pendingX, pendingY));
        setOrangePos(calculatePosition(orangeRef.current, pendingX, pendingY));
        setYellowPos(calculatePosition(yellowRef.current, pendingX, pendingY));
      }
      rafId = requestAnimationFrame(tick);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    rafId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  /* ---------- 表情联动 ---------- */

  // 账号框聚焦时对视 0.8 秒就收——一直对视会显得呆
  useEffect(() => {
    if (!isTyping) {
      setIsLookingAtEachOther(false);
      return undefined;
    }
    setIsLookingAtEachOther(true);
    const timer = setTimeout(() => setIsLookingAtEachOther(false), 800);
    return () => clearTimeout(timer);
  }, [isTyping]);

  // 密码明文时，紫色隔 2–5 秒偷瞄一次。
  // 依赖里带上 passwordLength：还在输入就不断重排，停手之后才瞄那一下
  useEffect(() => {
    if (!isPeeping) {
      setIsPurplePeeking(false);
      return undefined;
    }
    let backTimer;
    const peekTimer = setTimeout(() => {
      setIsPurplePeeking(true);
      backTimer = setTimeout(() => setIsPurplePeeking(false), 800);
    }, Math.random() * 3000 + 2000);
    return () => {
      clearTimeout(peekTimer);
      clearTimeout(backTimer);
    };
  }, [isPeeping, passwordLength]);

  /**
   * 密码框聚焦期间，黑色身体是转开的，但每隔 2–5 秒会往右瞟一眼——
   * 表单在右半屏，往右看就是在瞄密码框。捂着眼从指缝里偷看那个意思。
   */
  useEffect(() => {
    if (!isLookingAway || REDUCE_MOTION) {
      setIsBlackPeeking(false);
      return undefined;
    }
    let peekTimer;
    let backTimer;
    let cancelled = false;

    const schedule = () => {
      peekTimer = setTimeout(() => {
        if (cancelled) return;
        setIsBlackPeeking(true);
        backTimer = setTimeout(() => {
          if (cancelled) return;
          setIsBlackPeeking(false);
          schedule();
        }, 900);
      }, Math.random() * 3000 + 2000);
    };
    schedule();

    return () => {
      cancelled = true;
      clearTimeout(peekTimer);
      clearTimeout(backTimer);
    };
  }, [isLookingAway]);

  // 登录失败摇头。两个动画名交替用，详见 CSS 里的说明
  useEffect(() => {
    if (!loginFailed || REDUCE_MOTION) {
      setShakeSlot(0);
      return undefined;
    }
    setShakeSlot((prev) => (prev === 1 ? 2 : 1));
    const timer = setTimeout(() => setShakeSlot(0), 800);
    return () => clearTimeout(timer);
  }, [loginFailed]);

  /* ---------- 坐标与样式 ---------- */

  // 紫色：两只 18px 眼球 + 32px 间距 = 68 宽，嘴 24 宽，下移 32
  const purpleFace = isLookingAway
    ? faceLayout(20, 25, 68, 24, 32)
    : isPeeping
    ? faceLayout(20, 35, 68, 24, 32)
    : isLookingAtEachOther
    ? faceLayout(55, 65, 68, 24, 32)
    : faceLayout(30 + purplePos.faceX, 40 + purplePos.faceY, 68, 24, 32);

  // 橙色：两颗 12px 瞳孔 + 32px 间距 = 56 宽，嘴 26 宽，下移 32
  const orangeFace = isLookingAway
    ? faceLayout(50, 75, 56, 26, 32)
    : isPeeping
    ? faceLayout(50, 85, 56, 26, 32)
    : faceLayout(82 + orangePos.faceX, 90 + orangePos.faceY, 56, 26, 32);

  const mouthClass = [
    loginFailed ? "is-sad" : "",
    loginSuccess && !loginFailed ? "is-happy" : "",
    (isTyping || isHidingPassword) && !loginFailed && !loginSuccess ? "is-typing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const shakeClass = shakeSlot === 1 ? " ac-shake-a" : shakeSlot === 2 ? " ac-shake-b" : "";

  const charStyle = (backgroundColor, zIndex, transform, box) => {
    // 跟随鼠标要跟手（0.1s），换姿势要有过程（0.6s）——
    // 一律用长时长的话，鼠标移动会拖出一条糊影
    const speed = isPasswordFocused || isTyping ? "0.6s" : "0.1s";
    return {
      position: "absolute",
      backgroundColor,
      zIndex,
      transformOrigin: "bottom center",
      willChange: "transform",
      backfaceVisibility: "hidden",
      WebkitBackfaceVisibility: "hidden",
      transition: `transform ${speed} ease-out, height 0.6s ease-in-out`,
      transform,
      // 角色倾斜时底边会露出一条背景色缝隙，往下压 2px 再用同色描边补上
      bottom: "-2px",
      borderBottom: `4px solid ${backgroundColor}`,
      ...box,
    };
  };

  /** 橙色和黄色只有「偷看时站直」和「跟随鼠标」两种 */
  const plainTransform = (pos) =>
    isPeeping ? "skewX(0deg) translateZ(0)" : `skewX(${pos.bodySkew}deg) translateZ(0)`;

  const purpleTransform = isPeeping
    ? "skewX(0deg) translateZ(0)"
    : isLookingAway
    ? "skewX(-14deg) translateX(-20px) translateZ(0)"
    : isTyping || isHidingPassword
    ? `skewX(${purplePos.bodySkew - 12}deg) translateX(40px) translateZ(0)`
    : `skewX(${purplePos.bodySkew}deg) translateZ(0)`;

  const blackTransform = isPeeping
    ? "skewX(0deg) translateZ(0)"
    : isLookingAway
    ? "skewX(12deg) translateX(-10px) translateZ(0)"
    : isLookingAtEachOther
    ? `skewX(${blackPos.bodySkew * 1.5 + 10}deg) translateX(20px) translateZ(0)`
    : `skewX(${blackPos.bodySkew * 1.5}deg) translateZ(0)`;

  return (
    <div className="ac-scene">
      {/* 紫色长方形 · 最后层。left 110 + width 150 → 右边 260，
          和黑色（left 240）重叠 20px：身体一倾斜，贴边就会露出背景缝 */}
      <div
        ref={purpleRef}
        style={charStyle("#287A68", 1, purpleTransform, {
          left: "110px",
          width: "150px",
          height: isLookingAway || isTyping || isHidingPassword ? "440px" : "400px",
          borderRadius: "10px 10px 0 0",
        })}
      >
        <div
          className={`ac-eyes ac-eyes--slow${shakeClass}`}
          style={{ gap: "32px", left: `${purpleFace.eyeX}px`, top: `${purpleFace.eyeY}px` }}
        >
          {[0, 1].map((i) => (
            <EyeBall
              key={i}
              mouseX={mouse.x}
              mouseY={mouse.y}
              isBlinking={purpleBlinking}
              forceLookX={
                isLookingAway ? -5 : isPeeping ? (isPurplePeeking ? 4 : -4) : isLookingAtEachOther ? 3 : undefined
              }
              forceLookY={
                isLookingAway ? -5 : isPeeping ? (isPurplePeeking ? 5 : -4) : isLookingAtEachOther ? 4 : undefined
              }
            />
          ))}
        </div>

        <div
          className={`ac-mouth ac-mouth--purple ${mouthClass}`}
          style={{
            left: `${purpleFace.mouthX}px`,
            top: `${purpleFace.mouthY}px`,
            // 身体在 skew，嘴要反向抵消回来才是正的
            "--counter-skew":
              isTyping || isHidingPassword ? `skewX(${-(purplePos.bodySkew - 12)}deg)` : "skewX(0deg)",
          }}
        />
      </div>

      {/* 黑色长方形 · 中层（没有嘴，全靠眼睛演） */}
      <div
        ref={blackRef}
        style={charStyle("#2D2D2D", 2, blackTransform, {
          left: "240px",
          width: "120px",
          height: "310px",
          borderRadius: "8px 8px 0 0",
        })}
      >
        <div
          className={`ac-eyes ac-eyes--slow${shakeClass}`}
          style={{
            gap: "24px",
            left: isLookingAway
              ? "10px"
              : isPeeping
              ? "10px"
              : isLookingAtEachOther
              ? "32px"
              : `${26 + blackPos.faceX}px`,
            top: isLookingAway
              ? "20px"
              : isPeeping
              ? "28px"
              : isLookingAtEachOther
              ? "12px"
              : `${32 + blackPos.faceY}px`,
          }}
        >
          {[-20, 20].map((rotate) => (
            <EyeBall
              key={rotate}
              mouseX={mouse.x}
              mouseY={mouse.y}
              size={16}
              pupilSize={6}
              isBlinking={blackBlinking}
              isSad={loginFailed}
              sadRotate={rotate}
              forceLookX={
                isLookingAway ? (isBlackPeeking ? 5 : -4) : isPeeping ? -4 : isLookingAtEachOther ? 0 : undefined
              }
              forceLookY={
                isLookingAway ? (isBlackPeeking ? 0 : -5) : isPeeping ? -4 : isLookingAtEachOther ? -4 : undefined
              }
            />
          ))}
        </div>
      </div>

      {/* 橙色半圆 · 左前 */}
      <div
        ref={orangeRef}
        style={charStyle("#FF9B6B", 3, plainTransform(orangePos), {
          left: "0px",
          width: "240px",
          height: "200px",
          borderRadius: "120px 120px 0 0",
        })}
      >
        <div
          className={`ac-eyes ac-eyes--fast${shakeClass}`}
          style={{ gap: "32px", left: `${orangeFace.eyeX}px`, top: `${orangeFace.eyeY}px` }}
        >
          {[0, 1].map((i) => (
            <Pupil
              key={i}
              mouseX={mouse.x}
              mouseY={mouse.y}
              forceLookX={isLookingAway || isPeeping ? -5 : undefined}
              forceLookY={isLookingAway ? -5 : isPeeping ? -4 : undefined}
            />
          ))}
        </div>

        <div
          className={`ac-mouth ac-mouth--orange ${mouthClass}`}
          style={{ left: `${orangeFace.mouthX}px`, top: `${orangeFace.mouthY}px` }}
        />
      </div>

      {/* 黄色圆顶长方形 · 右前 */}
      <div
        ref={yellowRef}
        style={charStyle("#E8C775", 4, plainTransform(yellowPos), {
          left: "310px",
          width: "140px",
          height: "230px",
          borderRadius: "70px 70px 0 0",
        })}
      >
        <div
          className={`ac-eyes ac-eyes--fast${shakeClass}`}
          style={{
            gap: "24px",
            left: isLookingAway ? "20px" : isPeeping ? "20px" : `${52 + yellowPos.faceX}px`,
            top: isLookingAway ? "30px" : isPeeping ? "35px" : `${40 + yellowPos.faceY}px`,
          }}
        >
          {[0, 1].map((i) => (
            <Pupil
              key={i}
              mouseX={mouse.x}
              mouseY={mouse.y}
              forceLookX={isLookingAway || isPeeping ? -5 : undefined}
              forceLookY={isLookingAway ? -5 : isPeeping ? -4 : undefined}
            />
          ))}
        </div>

        {/* 一条横线，用 CSS 的 d 属性过渡成波浪（失败）或弧线（成功） */}
        <div
          className={`ac-mouth-line${shakeClass}`}
          style={{
            left: isLookingAway ? "15px" : isPeeping ? "10px" : `${40 + yellowPos.faceX}px`,
            top: isLookingAway ? "70px" : isPeeping ? "80px" : `${80 + yellowPos.faceY}px`,
          }}
        >
          <svg width="80" height="20" viewBox="0 0 80 20">
            <path
              className={`ac-mouth-line__path${
                loginFailed ? " ac-mouth-line__path--wavy" : loginSuccess ? " ac-mouth-line__path--happy" : ""
              }`}
              stroke="#2D2D2D"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
