import React, { useEffect, useRef } from 'react';

export const ParticleBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas to full window size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Matrix characters (Katakana + Latin + Numerals)
    const charset = 'アァカサタナハマヤャラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユュルグズブヅプエェケセテネヘメレゲゼデベペオォコソトノホモヨョロゴゾドボポヴッン0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const chars = charset.split('');

    const fontSize = 14;
    let columns = canvas.width / fontSize;
    
    // Array of drops - one per column
    let drops: number[] = [];
    for (let x = 0; x < columns; x++) {
      drops[x] = Math.random() * -100; // start randomly off-screen
    }

    let animationFrameId: number;

    const draw = () => {
      // Semi-transparent black to create the fading trail effect
      ctx.fillStyle = 'rgba(5, 0, 15, 0.1)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Deep purple glow for characters
      ctx.fillStyle = '#a855f7'; 
      ctx.font = `${fontSize}px monospace`;
      
      // Update columns count to handle resize dynamically without re-initing drops
      const currentCols = Math.floor(canvas.width / fontSize);
      if (currentCols > drops.length) {
        for (let x = drops.length; x < currentCols; x++) {
          drops[x] = Math.random() * -100;
        }
      }

      for (let i = 0; i < drops.length; i++) {
        // Random character
        const text = chars[Math.floor(Math.random() * chars.length)];
        
        // Draw the character
        // Highlight the "head" of the stream with a brighter color
        if (Math.random() > 0.95) {
          ctx.fillStyle = '#d8b4fe'; // Brighter purple for occasional head highlights
        } else {
          ctx.fillStyle = '#a855f7'; // Standard neon purple
        }
        
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);

        // Reset drop to top randomly when it crosses the screen
        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }

        // Move drop down
        drops[i]++;
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 0,
        // Add perspective and radial gradient vignette to simulate 3D tunnel depth like the image
        background: 'radial-gradient(circle at center, #1a0b2e 0%, #000000 70%)',
        opacity: 0.85
      }}
    />
  );
};

export default ParticleBackground;
