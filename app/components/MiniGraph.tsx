import { useRef, useState } from "react";
import { useEffect } from "react";

export const MiniGraph = ({ dataRef, minVal = -15, maxVal = 15 }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let animationId;

    const draw = () => {
      const data = dataRef.current;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d"); // Ensure ctx is defined here if not in scope

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw Background
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (data.length < 2) {
        animationId = requestAnimationFrame(draw);
        return;
      }

      const MIN_VAL = minVal;
      const MAX_VAL = maxVal;
      const RANGE = MAX_VAL - MIN_VAL;

      // Draw center line (0 value)
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.3)"; // Lighter color for guideline
      ctx.lineWidth = 1;
      const zeroY = (MAX_VAL - 0) / RANGE * canvas.height;
      ctx.moveTo(0, zeroY);
      ctx.lineTo(canvas.width, zeroY);
      ctx.stroke();

      // Draw Line for data
      ctx.beginPath();
      ctx.strokeStyle = "#00ff00";
      ctx.lineWidth = 2;

      const step = canvas.width / 100; // Assuming we keep 100 points

      data.forEach((point, i) => {
        const x = i * step;
        // Map point.value from [MIN_VAL, MAX_VAL] to canvas height [0, canvas.height]
        const y = (MAX_VAL - point.value) / RANGE * canvas.height;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      ctx.stroke();
      animationId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={100}
      style={{ border: "1px solid #555", marginTop: "10px" }}
    />
  );
};
