/**
 * NBD Pro Theme Engine - Visual Overlay Renderer
 * Creates atmospheric visual effects behind CRM content
 * Supports 37+ overlay types: CSS-only and canvas-based particle systems
 */

(function() {
  'use strict';

  const ThemeOverlays = {
    enabled: true,
    container: null,
    canvas: null,
    ctx: null,
    currentOverlay: null,
    particles: [],
    animationId: null,
    frameCount: 0,
    isHidden: false,
    minScreenWidth: 768,

    // ==================== INITIALIZATION ====================
    init() {
      if (this.container) return;

      // Create overlay container
      const container = document.createElement('div');
      container.id = 'te-overlay';
      container.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 0;
        overflow: hidden;
      `;

      // Create canvas for particle effects
      const canvas = document.createElement('canvas');
      canvas.id = 'te-canvas';
      canvas.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        display: block;
      `;

      container.appendChild(canvas);
      document.body.insertBefore(container, document.body.firstChild);

      this.container = container;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { willReadFrequently: false });
      this.setupCanvas();

      // Visibility listener
      document.addEventListener('visibilitychange', () => {
        this.isHidden = document.hidden;
      });

      // Resize listener (debounced)
      let resizeTimeout;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => this.setupCanvas(), 150);
      });
    },

    setupCanvas() {
      if (!this.canvas || !this.ctx) return;
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    },

    // ==================== PUBLIC API ====================
    apply(overlayConfig) {
      if (!this.enabled) return;
      if (!this.container) this.init();

      this.destroy();

      if (!overlayConfig || !overlayConfig.type) return;

      // Mobile optimization
      if (window.innerWidth < this.minScreenWidth) {
        console.log('[ThemeOverlays] Mobile detected, skipping overlay');
        return;
      }

      const { type, ...config } = overlayConfig;
      const overlayFunc = this.overlayLibrary[type];

      if (!overlayFunc) {
        console.warn(`[ThemeOverlays] Unknown overlay type: ${type}`);
        return;
      }

      this.currentOverlay = { type, config };
      overlayFunc.call(this, this.container, config);
    },

    destroy() {
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }

      this.particles = [];
      this.frameCount = 0;

      if (this.canvas && this.ctx) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.canvas.style.display = 'none';
      }

      if (this.container) {
        // Keep canvas, clear other content
        const children = Array.from(this.container.children);
        children.forEach(child => {
          if (child.id !== 'te-canvas') {
            child.remove();
          }
        });
      }
    },

    setEnabled(enabled) {
      this.enabled = enabled;
      if (!enabled && this.container) {
        this.destroy();
      }
    },

    isEnabled() {
      return this.enabled;
    },

    // ==================== UTILITY HELPERS ====================
    createSVG(width, height, viewBox) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', width);
      svg.setAttribute('height', height);
      svg.setAttribute('viewBox', viewBox);
      return svg;
    },

    addParticle(x, y, vx, vy, size, color, opacity, life) {
      this.particles.push({
        x, y, vx, vy, size, color, opacity, life, maxLife: life
      });
    },

    animationLoop(callback) {
      const tick = () => {
        if (this.isHidden) {
          this.animationId = requestAnimationFrame(tick);
          return;
        }

        this.frameCount++;
        // Frame skipping for 30fps (skip every other frame @ 60fps)
        if (this.frameCount % 2 === 0) {
          callback();
        }

        this.animationId = requestAnimationFrame(tick);
      };
      this.animationId = requestAnimationFrame(tick);
    },

    // ==================== OVERLAY LIBRARY ====================
    overlayLibrary: {

      // CSS-ONLY OVERLAYS

      'film-grain'() {
        const div = document.createElement('div');
        div.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          opacity: 0.03;
          background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><filter id="noise"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" result="noise" /></filter><rect width="100" height="100" fill="white" filter="url(%23noise)" /></svg>');
          will-change: transform;
          animation: grain-shift 0.2s infinite;
        `;

        if (!document.querySelector('style[data-grain-animation]')) {
          const style = document.createElement('style');
          style.setAttribute('data-grain-animation', 'true');
          style.textContent = `
            @keyframes grain-shift {
              0% { transform: translate(0, 0); }
              10% { transform: translate(-2px, -1px); }
              20% { transform: translate(-1px, 2px); }
              30% { transform: translate(1px, -2px); }
              40% { transform: translate(2px, 1px); }
              50% { transform: translate(-1px, -1px); }
              60% { transform: translate(1px, 2px); }
              70% { transform: translate(-2px, -2px); }
              80% { transform: translate(2px, -1px); }
              90% { transform: translate(-1px, 1px); }
              100% { transform: translate(0, 0); }
            }
          `;
          document.head.appendChild(style);
        }

        this.container.appendChild(div);
      },

      'ruled-lines'() {
        const div = document.createElement('div');
        div.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          opacity: 0.04;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 24px,
            rgba(0, 0, 0, 0.3) 24px,
            rgba(0, 0, 0, 0.3) 25px
          );
        `;
        this.container.appendChild(div);
      },

      'vertical-lines'() {
        const div = document.createElement('div');
        div.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          opacity: 0.05;
          background: repeating-linear-gradient(
            90deg,
            transparent,
            transparent 19px,
            rgba(128, 128, 128, 0.4) 19px,
            rgba(128, 128, 128, 0.4) 20px
          );
        `;
        this.container.appendChild(div);
      },

      'hexagonal'() {
        const svg = this.createSVG('100%', '100%', '0 0 100 100');
        svg.style.cssText = 'position: absolute; top: 0; left: 0; opacity: 0.04;';

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
        pattern.setAttribute('id', 'hex-pattern');
        pattern.setAttribute('x', '20');
        pattern.setAttribute('y', '20');
        pattern.setAttribute('width', '50');
        pattern.setAttribute('height', '50');
        pattern.setAttribute('patternUnits', 'userSpaceOnUse');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M25,5 L45,15 L45,35 L25,45 L5,35 L5,15 Z');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'rgba(0, 0, 0, 0.8)');
        path.setAttribute('stroke-width', '0.5');

        pattern.appendChild(path);
        defs.appendChild(pattern);
        svg.appendChild(defs);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('width', '100%');
        rect.setAttribute('height', '100%');
        rect.setAttribute('fill', 'url(#hex-pattern)');
        svg.appendChild(rect);

        this.container.appendChild(svg);
      },

      'wood-grain'() {
        const svg = this.createSVG('100%', '100%', '0 0 200 200');
        svg.style.cssText = 'position: absolute; top: 0; left: 0; opacity: 0.05;';

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
        filter.setAttribute('id', 'wood');

        const turbulence = document.createElementNS('http://www.w3.org/2000/svg', 'feTurbulence');
        turbulence.setAttribute('type', 'fractalNoise');
        turbulence.setAttribute('baseFrequency', '0.02');
        turbulence.setAttribute('numOctaves', '5');
        turbulence.setAttribute('result', 'noise');

        const displacement = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
        displacement.setAttribute('in', 'SourceGraphic');
        displacement.setAttribute('in2', 'noise');
        displacement.setAttribute('scale', '20');

        filter.appendChild(turbulence);
        filter.appendChild(displacement);
        defs.appendChild(filter);
        svg.appendChild(defs);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('width', '100%');
        rect.setAttribute('height', '100%');
        rect.setAttribute('fill', 'rgba(139, 69, 19, 0.1)');
        rect.setAttribute('filter', 'url(#wood)');
        svg.appendChild(rect);

        this.container.appendChild(svg);
      },

      'ink-wash'() {
        const div = document.createElement('div');
        div.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: linear-gradient(
            180deg,
            rgba(0, 0, 0, 0) 0%,
            rgba(0, 0, 0, 0.02) 25%,
            rgba(0, 0, 0, 0.04) 50%,
            rgba(0, 0, 0, 0.02) 75%,
            rgba(0, 0, 0, 0) 100%
          );
        `;
        this.container.appendChild(div);
      },

      'earth-crack'() {
        const svg = this.createSVG('100%', '100%', '0 0 1000 1000');
        svg.style.cssText = 'position: absolute; top: 0; left: 0; opacity: 0.06;';

        for (let i = 0; i < 8; i++) {
          const x1 = Math.random() * 1000;
          const y1 = Math.random() * 1000;
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', `M${x1},${y1} Q${x1 + Math.random() * 200 - 100},${y1 + Math.random() * 200 - 100} ${x1 + Math.random() * 400 - 200},${y1 + Math.random() * 400 - 200}`);
          path.setAttribute('stroke', 'rgba(0, 0, 0, 0.8)');
          path.setAttribute('stroke-width', '2');
          path.setAttribute('fill', 'none');
          svg.appendChild(path);
        }

        this.container.appendChild(svg);
      },

      'vhs-lines'() {
        const div = document.createElement('div');
        div.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          opacity: 0.02;
          background: repeating-linear-gradient(
            0deg,
            rgba(0, 0, 0, 0.5) 0px,
            rgba(0, 0, 0, 0.5) 1px,
            transparent 1px,
            transparent 3px
          );
        `;
        this.container.appendChild(div);
      },

      'perspective-grid'() {
        const div = document.createElement('div');
        div.style.cssText = `
          position: absolute;
          top: 50%;
          left: 50%;
          width: 200%;
          height: 200%;
          transform: translate(-50%, -50%) perspective(800px) rotateX(60deg);
          opacity: 0.04;
          background-image:
            linear-gradient(0deg, transparent 24%, rgba(100, 100, 255, 0.05) 25%, rgba(100, 100, 255, 0.05) 26%, transparent 27%, transparent 74%, rgba(100, 100, 255, 0.05) 75%, rgba(100, 100, 255, 0.05) 76%, transparent 77%, transparent),
            linear-gradient(90deg, transparent 24%, rgba(100, 100, 255, 0.05) 25%, rgba(100, 100, 255, 0.05) 26%, transparent 27%, transparent 74%, rgba(100, 100, 255, 0.05) 75%, rgba(100, 100, 255, 0.05) 76%, transparent 77%, transparent);
          background-size: 50px 50px;
        `;
        this.container.appendChild(div);
      },

      'watercolor'() {
        const div = document.createElement('div');
        div.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          opacity: 0.04;
        `;

        for (let i = 0; i < 6; i++) {
          const spot = document.createElement('div');
          const colors = ['rgba(180, 140, 100)', 'rgba(120, 160, 140)', 'rgba(160, 120, 140)'];
          const color = colors[Math.floor(Math.random() * colors.length)];
          spot.style.cssText = `
            position: absolute;
            border-radius: 50%;
            filter: blur(80px);
            opacity: 0.15;
            background: radial-gradient(ellipse at 30% 30%, ${color}, transparent);
            width: 300px;
            height: 300px;
            top: ${Math.random() * 100}%;
            left: ${Math.random() * 100}%;
            transform: translate(-50%, -50%);
          `;
          div.appendChild(spot);
        }

        this.container.appendChild(div);
      },

      'journal-symbols'() {
        const symbols = ['∞', '◊', '◆', '✦', '※', '◈', '✧', '⟡'];
        const div = document.createElement('div');
        div.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
        `;

        for (let i = 0; i < 15; i++) {
          const span = document.createElement('span');
          span.textContent = symbols[Math.floor(Math.random() * symbols.length)];
          span.style.cssText = `
            position: absolute;
            opacity: 0.03;
            font-size: ${20 + Math.random() * 40}px;
            color: black;
            top: ${Math.random() * 100}%;
            left: ${Math.random() * 100}%;
            transform: rotate(${Math.random() * 360}deg) translate(-50%, -50%);
          `;
          div.appendChild(span);
        }

        this.container.appendChild(div);
      },

      'dramatic-lines'() {
        const svg = this.createSVG('100%', '100%', '0 0 1000 1000');
        svg.style.cssText = 'position: absolute; top: 0; left: 0; opacity: 0.04;';

        for (let i = 0; i < 20; i++) {
          const angle = (i / 20) * Math.PI * 2;
          const x = 500 + Math.cos(angle) * 400;
          const y = 500 + Math.sin(angle) * 400;
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', '500');
          line.setAttribute('y1', '500');
          line.setAttribute('x2', x);
          line.setAttribute('y2', y);
          line.setAttribute('stroke', 'rgba(0, 0, 0, 0.5)');
          line.setAttribute('stroke-width', '1');
          svg.appendChild(line);
        }

        this.container.appendChild(svg);
      },

      'slash-marks'() {
        const div = document.createElement('div');
        div.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          opacity: 0.04;
          background: repeating-linear-gradient(
            45deg,
            transparent,
            transparent 10px,
            rgba(0, 0, 0, 0.3) 10px,
            rgba(0, 0, 0, 0.3) 12px
          );
        `;
        this.container.appendChild(div);
      },

      'spotlight-vignette'() {
        const div = document.createElement('div');
        div.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: radial-gradient(ellipse at center, transparent 0%, rgba(0, 0, 0, 0.6) 100%);
          opacity: 0.5;
        `;
        this.container.appendChild(div);
      },

      'scroll-texture'() {
        const svg = this.createSVG('100%', '100%', '0 0 200 200');
        svg.style.cssText = 'position: absolute; top: 0; left: 0; opacity: 0.04;';

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
        filter.setAttribute('id', 'parchment');

        const feTurbulence = document.createElementNS('http://www.w3.org/2000/svg', 'feTurbulence');
        feTurbulence.setAttribute('type', 'fractalNoise');
        feTurbulence.setAttribute('baseFrequency', '0.04');
        feTurbulence.setAttribute('numOctaves', '4');

        filter.appendChild(feTurbulence);
        defs.appendChild(filter);
        svg.appendChild(defs);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('width', '100%');
        rect.setAttribute('height', '100%');
        rect.setAttribute('fill', 'rgba(240, 235, 220, 0.1)');
        rect.setAttribute('filter', 'url(#parchment)');
        svg.appendChild(rect);

        this.container.appendChild(svg);
      },

      'compass-rose'() {
        const svg = this.createSVG('300', '300', '0 0 100 100');
        svg.style.cssText = `
          position: absolute;
          bottom: 40px;
          right: 40px;
          opacity: 0.08;
        `;

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '50');
        circle.setAttribute('cy', '50');
        circle.setAttribute('r', '40');
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', 'rgba(0, 0, 0, 0.5)');
        circle.setAttribute('stroke-width', '1');

        const points = [
          { dir: 'N', x: 50, y: 10 },
          { dir: 'E', x: 90, y: 50 },
          { dir: 'S', x: 50, y: 90 },
          { dir: 'W', x: 10, y: 50 }
        ];

        points.forEach(p => {
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', p.x);
          text.setAttribute('y', p.y);
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('font-size', '8');
          text.setAttribute('fill', 'rgba(0, 0, 0, 0.6)');
          text.textContent = p.dir;
          svg.appendChild(text);
        });

        svg.appendChild(circle);
        this.container.appendChild(svg);
      },

      'cloud-top'() {
        const div = document.createElement('div');
        div.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 15%;
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.05) 0%,
            transparent 100%
          );
        `;
        this.container.appendChild(div);
      },

      'cloud-drift'() {
        const div = document.createElement('div');
        div.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
        `;

        if (!document.querySelector('style[data-cloud-animation]')) {
          const style = document.createElement('style');
          style.setAttribute('data-cloud-animation', 'true');
          style.textContent = `
            @keyframes cloud-drift {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(100%); }
            }
            .cloud-shape {
              position: absolute;
              background: radial-gradient(ellipse at 30% 40%, rgba(200, 200, 200, 0.15), transparent);
              border-radius: 100px;
              will-change: transform;
            }
          `;
          document.head.appendChild(style);
        }

        for (let i = 0; i < 4; i++) {
          const cloud = document.createElement('div');
          cloud.className = 'cloud-shape';
          const size = 100 + Math.random() * 150;
          cloud.style.cssText = `
            width: ${size}px;
            height: ${size * 0.4}px;
            top: ${20 + Math.random() * 30}%;
            left: 0;
            animation: cloud-drift ${15 + Math.random() * 10}s linear infinite;
            animation-delay: ${i * 4}s;
          `;
          div.appendChild(cloud);
        }

        this.container.appendChild(div);
      },

      'fog-edge'() {
        const div = document.createElement('div');
        div.style.cssText = `
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: 40%;
          background: linear-gradient(
            180deg,
            transparent 0%,
            rgba(100, 100, 120, 0.08) 50%,
            rgba(80, 80, 100, 0.12) 100%
          );
        `;
        this.container.appendChild(div);
      },

      'dark-fog'() {
        const div = document.createElement('div');
        div.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: linear-gradient(
            180deg,
            rgba(40, 40, 60, 0.08) 0%,
            rgba(40, 40, 60, 0.12) 50%,
            rgba(40, 40, 60, 0.1) 100%
          );
        `;
        this.container.appendChild(div);
      },

      'dna-helix'() {
        const svg = this.createSVG('100%', '100%', '0 0 400 800');
        svg.style.cssText = 'position: absolute; top: 0; left: 0; opacity: 0.06;';

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path1.setAttribute('id', 'helix1');
        path1.setAttribute('d', 'M 100,0 Q 150,25 100,50 Q 50,75 100,100 Q 150,125 100,150 Q 50,175 100,200 Q 150,225 100,250 Q 50,275 100,300 Q 150,325 100,350 Q 50,375 100,400 Q 150,425 100,450 Q 50,475 100,500 Q 150,525 100,550 Q 50,575 100,600 Q 150,625 100,650 Q 50,675 100,700 Q 150,725 100,750 Q 50,775 100,800');
        path1.setAttribute('stroke', 'rgba(100, 200, 100, 0.6)');
        path1.setAttribute('stroke-width', '2');
        path1.setAttribute('fill', 'none');

        const path2 = path1.cloneNode();
        path2.setAttribute('id', 'helix2');
        path2.setAttribute('d', 'M 300,0 Q 250,25 300,50 Q 350,75 300,100 Q 250,125 300,150 Q 350,175 300,200 Q 250,225 300,250 Q 350,275 300,300 Q 250,325 300,350 Q 350,375 300,400 Q 250,425 300,450 Q 350,475 300,500 Q 250,525 300,550 Q 350,575 300,600 Q 250,625 300,650 Q 350,675 300,700 Q 250,725 300,750 Q 350,775 300,800');

        defs.appendChild(path1);
        defs.appendChild(path2);
        svg.appendChild(defs);

        const use1 = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use1.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#helix1');
        svg.appendChild(use1);

        const use2 = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use2.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#helix2');
        svg.appendChild(use2);

        this.container.appendChild(svg);
      },

      // CANVAS-BASED PARTICLE OVERLAYS

      'bubbles'(container, config) {
        const color = config.color || 'rgba(100, 200, 255, 0.4)';
        const density = config.density || 0.5;
        const speed = config.speed || 1;

        const particleCount = Math.floor(40 * density);
        for (let i = 0; i < particleCount; i++) {
          this.addParticle(
            Math.random() * this.canvas.width,
            Math.random() * this.canvas.height,
            (Math.random() - 0.5) * 0.5 * speed,
            -Math.random() * 1.5 * speed,
            Math.random() * 8 + 4,
            color,
            0.6,
            Infinity
          );
        }

        this.canvas.style.display = 'block';
        this.animationLoop(() => this.renderParticles());
      },

      'star-twinkle'(container, config) {
        const color = config.color || 'rgba(255, 255, 200, 0.8)';
        const density = config.density || 0.5;

        const starCount = Math.floor(60 * density);
        for (let i = 0; i < starCount; i++) {
          this.addParticle(
            Math.random() * this.canvas.width,
            Math.random() * this.canvas.height,
            0,
            0,
            Math.random() * 2 + 1,
            color,
            Math.random() * 0.5 + 0.3,
            Infinity
          );
        }

        this.canvas.style.display = 'block';
        this.animationLoop(() => {
          this.particles.forEach(p => {
            p.opacity = Math.abs(Math.sin((Date.now() + p.x + p.y) / 500)) * 0.7 + 0.2;
          });
          this.renderParticles();
        });
      },

      'star-field'(container, config) {
        const color = config.color || 'rgba(255, 255, 255, 0.9)';
        const density = config.density || 0.5;
        const speed = config.speed || 0.3;

        const starCount = Math.floor(80 * density);
        for (let i = 0; i < starCount; i++) {
          this.addParticle(
            Math.random() * this.canvas.width,
            Math.random() * this.canvas.height,
            0,
            0,
            Math.random() * 1.5 + 0.5,
            color,
            0.8,
            Infinity
          );
        }

        // Occasional shooting star
        const shootingStarInterval = setInterval(() => {
          const sx = Math.random() * this.canvas.width;
          const sy = Math.random() * this.canvas.height * 0.5;
          for (let i = 0; i < 40; i++) {
            this.addParticle(
              sx + (i * 8),
              sy,
              speed * 3,
              0,
              1,
              color,
              0.6 * (1 - i / 40),
              1000
            );
          }
        }, 4000);

        this.canvas.style.display = 'block';
        this.animationLoop(() => this.renderParticles());

        // Cleanup interval on destroy
        const originalDestroy = this.destroy.bind(this);
        this.destroy = () => {
          clearInterval(shootingStarInterval);
          originalDestroy();
        };
      },

      'ember-particles'(container, config) {
        const density = config.density || 0.5;
        const speed = config.speed || 1;

        const emberCount = Math.floor(35 * density);
        for (let i = 0; i < emberCount; i++) {
          this.addParticle(
            Math.random() * this.canvas.width,
            this.canvas.height,
            (Math.random() - 0.5) * 0.8,
            -Math.random() * 2 * speed,
            Math.random() * 6 + 3,
            'rgba(255, 140, 60, 0.6)',
            0.7,
            3000
          );
        }

        this.canvas.style.display = 'block';
        this.animationLoop(() => {
          this.updateParticles();
          this.renderParticles();
        });
      },

      'water-flow'(container, config) {
        const density = config.density || 0.5;
        const speed = config.speed || 1;

        const waveCount = Math.floor(30 * density);
        for (let i = 0; i < waveCount; i++) {
          this.addParticle(
            0,
            Math.random() * this.canvas.height,
            3 * speed,
            (Math.random() - 0.5) * 0.5,
            Math.random() * 20 + 15,
            'rgba(100, 180, 255, 0.3)',
            0.5,
            Infinity
          );
        }

        this.canvas.style.display = 'block';
        this.animationLoop(() => {
          this.updateParticles();
          this.renderParticles();
        });
      },

      'water-current'(container, config) {
        const density = config.density || 0.5;
        const speed = config.speed || 1;

        const currentCount = Math.floor(25 * density);
        for (let i = 0; i < currentCount; i++) {
          this.addParticle(
            Math.random() * this.canvas.width,
            0,
            (Math.random() - 0.5) * 0.8,
            2 * speed,
            Math.random() * 15 + 10,
            'rgba(100, 180, 255, 0.35)',
            0.4,
            Infinity
          );
        }

        this.canvas.style.display = 'block';
        this.animationLoop(() => {
          this.updateParticles();
          this.renderParticles();
        });
      },

      'dark-particles'(container, config) {
        const density = config.density || 0.5;
        const speed = config.speed || 1;

        const particleCount = Math.floor(40 * density);
        for (let i = 0; i < particleCount; i++) {
          this.addParticle(
            Math.random() * this.canvas.width,
            this.canvas.height,
            (Math.random() - 0.5) * 1,
            -Math.random() * 1.5 * speed,
            Math.random() * 5 + 2,
            'rgba(200, 150, 255, 0.5)',
            0.6,
            4000
          );
        }

        this.canvas.style.display = 'block';
        this.animationLoop(() => {
          this.updateParticles();
          this.renderParticles();
        });
      },

      'shadow-particles'(container, config) {
        const density = config.density || 0.5;
        const speed = config.speed || 1;

        const shadowCount = Math.floor(35 * density);
        for (let i = 0; i < shadowCount; i++) {
          this.addParticle(
            Math.random() * this.canvas.width,
            this.canvas.height,
            (Math.random() - 0.5) * 0.6,
            -Math.random() * 1.2 * speed,
            Math.random() * 4 + 2,
            'rgba(30, 60, 150, 0.5)',
            0.5,
            3500
          );
        }

        this.canvas.style.display = 'block';
        this.animationLoop(() => {
          this.updateParticles();
          this.renderParticles();
        });
      },

      'silver-cascade'(container, config) {
        const density = config.density || 0.5;
        const speed = config.speed || 1;

        const cascadeCount = Math.floor(50 * density);
        for (let i = 0; i < cascadeCount; i++) {
          this.addParticle(
            Math.random() * this.canvas.width,
            0,
            (Math.random() - 0.5) * 0.5,
            2.5 * speed,
            Math.random() * 5 + 2,
            'rgba(220, 220, 255, 0.7)',
            0.6,
            Infinity
          );
        }

        this.canvas.style.display = 'block';
        this.animationLoop(() => {
          this.updateParticles();
          this.renderParticles();
        });
      },

      'portal-swirl'(container, config) {
        const density = config.density || 0.5;
        const speed = config.speed || 1;

        const swirCount = Math.floor(40 * density);
        const centerX = this.canvas.width * 0.1;
        const centerY = this.canvas.height * 0.1;

        for (let i = 0; i < swirCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const distance = Math.random() * 100 + 50;
          this.addParticle(
            centerX + Math.cos(angle) * distance,
            centerY + Math.sin(angle) * distance,
            Math.cos(angle + Math.PI / 2) * 1.5 * speed,
            Math.sin(angle + Math.PI / 2) * 1.5 * speed,
            Math.random() * 4 + 2,
            'rgba(100, 255, 100, 0.6)',
            0.5,
            Infinity
          );
        }

        let swirAngle = 0;
        this.canvas.style.display = 'block';
        this.animationLoop(() => {
          swirAngle += 0.02 * speed;
          this.particles.forEach(p => {
            const angle = Math.atan2(p.y - centerY, p.x - centerX);
            const distance = Math.hypot(p.x - centerX, p.y - centerY);
            const newAngle = angle + swirAngle;
            p.x = centerX + Math.cos(newAngle) * distance;
            p.y = centerY + Math.sin(newAngle) * distance;
          });
          this.updateParticles();
          this.renderParticles();
        });
      },

      'aura-waves'(container, config) {
        const density = config.density || 0.5;
        const speed = config.speed || 1;

        let waveRadius = 0;
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        this.canvas.style.display = 'block';
        this.animationLoop(() => {
          waveRadius += 2 * speed;
          if (waveRadius > Math.hypot(centerX, centerY)) {
            waveRadius = 0;
          }

          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

          for (let i = 0; i < 8 * density; i++) {
            const opacity = Math.max(0, 0.6 - (waveRadius / 500) * 0.6);
            const radius = waveRadius + i * 30;
            this.ctx.strokeStyle = `rgba(100, 150, 255, ${opacity})`;
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            this.ctx.stroke();
          }
        });
      },

      'matrix-rain'(container, config) {
        const density = config.density || 0.5;
        const speed = config.speed || 1;
        const chars = '01アイウエオカキクケコサシスセソタチツテト';

        const columnCount = Math.floor(20 * density);
        const columns = [];
        const colWidth = this.canvas.width / columnCount;

        for (let i = 0; i < columnCount; i++) {
          columns.push({
            x: i * colWidth,
            y: Math.random() * this.canvas.height,
            speed: 1 * speed + Math.random() * 1
          });
        }

        this.canvas.style.display = 'block';
        this.animationLoop(() => {
          this.ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
          this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

          this.ctx.fillStyle = 'rgba(0, 255, 100, 0.7)';
          this.ctx.font = 'bold 16px monospace';

          columns.forEach(col => {
            col.y += col.speed;
            if (col.y > this.canvas.height) {
              col.y = -20;
            }
            const char = chars[Math.floor(Math.random() * chars.length)];
            this.ctx.fillText(char, col.x, col.y);
          });
        });
      },

      'data-stream'(container, config) {
        const density = config.density || 0.5;
        const speed = config.speed || 1;

        const characters = '0123456789ABCDEF';
        const streamCount = Math.floor(8 * density);
        const streams = [];

        for (let i = 0; i < streamCount; i++) {
          streams.push({
            x: (i / streamCount) * this.canvas.width,
            y: Math.random() * this.canvas.height,
            speed: speed * 2 + Math.random() * 1
          });
        }

        this.canvas.style.display = 'block';
        this.animationLoop(() => {
          this.ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
          this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

          this.ctx.fillStyle = 'rgba(200, 100, 255, 0.8)';
          this.ctx.font = '14px monospace';

          streams.forEach(stream => {
            stream.x += stream.speed;
            if (stream.x > this.canvas.width) {
              stream.x = -50;
            }

            for (let i = 0; i < 12; i++) {
              const char = characters[Math.floor(Math.random() * characters.length)];
              this.ctx.fillText(char, stream.x - i * 12, stream.y);
            }
          });
        });
      },

      'rain'(container, config) {
        const density = config.density || 0.5;
        const speed = config.speed || 1;

        const rainCount = Math.floor(80 * density);
        for (let i = 0; i < rainCount; i++) {
          this.addParticle(
            Math.random() * this.canvas.width,
            Math.random() * this.canvas.height,
            0,
            4 * speed,
            Math.random() * 2 + 1,
            'rgba(100, 150, 255, 0.6)',
            0.7,
            Infinity
          );
        }

        this.canvas.style.display = 'block';
        this.animationLoop(() => {
          this.updateParticles();
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

          this.particles.forEach(p => {
            if (p.y > this.canvas.height) p.y = -10;
            this.ctx.strokeStyle = `rgba(100, 150, 255, ${p.opacity})`;
            this.ctx.lineWidth = p.size;
            this.ctx.beginPath();
            this.ctx.moveTo(p.x, p.y);
            this.ctx.lineTo(p.x, p.y + 30);
            this.ctx.stroke();
          });
        });
      },

      'snow'(container, config) {
        const density = config.density || 0.5;
        const speed = config.speed || 1;

        const snowCount = Math.floor(60 * density);
        for (let i = 0; i < snowCount; i++) {
          this.addParticle(
            Math.random() * this.canvas.width,
            Math.random() * this.canvas.height,
            (Math.random() - 0.5) * 0.5,
            0.5 * speed,
            Math.random() * 5 + 2,
            'rgba(255, 255, 255, 0.8)',
            0.7,
            Infinity
          );
        }

        this.canvas.style.display = 'block';
        this.animationLoop(() => {
          this.updateParticles();
          this.renderParticles();
        });
      },

      'creepy-fog'(container, config) {
        const density = config.density || 0.5;
        const speed = config.speed || 1;

        const fogCount = Math.floor(45 * density);
        for (let i = 0; i < fogCount; i++) {
          this.addParticle(
            Math.random() * this.canvas.width,
            this.canvas.height * 0.7,
            (Math.random() - 0.5) * 0.3,
            -0.3 * speed,
            Math.random() * 60 + 40,
            'rgba(80, 90, 110, 0.2)',
            0.3,
            Infinity
          );
        }

        this.canvas.style.display = 'block';
        this.animationLoop(() => {
          this.updateParticles();
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

          this.particles.forEach(p => {
            this.ctx.fillStyle = `rgba(80, 90, 110, ${p.opacity * 0.4})`;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
            this.ctx.fill();
          });
        });
      }
    },

    // ==================== PARTICLE RENDERING ====================
    updateParticles() {
      this.particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.maxLife !== Infinity) {
          p.life -= 16;
          p.opacity = (p.life / p.maxLife) * (p.opacity / 1);
          if (p.life <= 0) {
            this.particles.splice(i, 1);
          }
        }

        // Wrap around edges
        if (p.x < -50) p.x = this.canvas.width + 50;
        if (p.x > this.canvas.width + 50) p.x = -50;
        if (p.y < -50) p.y = this.canvas.height + 50;
        if (p.y > this.canvas.height + 50) p.y = -50;
      });
    },

    renderParticles() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      this.particles.forEach(p => {
        this.ctx.fillStyle = p.color.replace(')', `, ${p.opacity})`).replace('rgba(', 'rgba(');
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
        this.ctx.fill();
      });
    }
  };

  // Expose globally
  window.ThemeOverlays = ThemeOverlays;

})();
