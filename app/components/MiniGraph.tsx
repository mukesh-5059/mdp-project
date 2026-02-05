import { useRef, useState } from "react";
import { useEffect } from "react";

export const MiniGraph = ({ dataRef }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let animationId;

    const draw = () => {
      const data = dataRef.current;
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw Background
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (data.length < 2) {
        animationId = requestAnimationFrame(draw);
        return;
      }

      // Draw Line
      ctx.beginPath();
      ctx.strokeStyle = "#00ff00";
      ctx.lineWidth = 2;

      const step = canvas.width / 100; // Assuming we keep 100 points

      data.forEach((point, i) => {
        const x = i * step;
        // Map intensity (0.0 to 1.5) to canvas height
        const y = canvas.height - (point.value / 0.1) * canvas.height;

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
