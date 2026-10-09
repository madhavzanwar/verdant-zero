import '../styles/map.css';
import * as THREE from 'three';

/**
 * MapSystem
 * 
 * High-performance 2D Canvas Minimap & Full Metropolis Sector Map for Verdant Zero.
 * 
 * Features:
 * - 220px top-left minimap with dark semi-opaque glass styling, running at throttled 30 FPS
 * - Centered on player, rotates with camera orientation or toggles to North-up mode
 * - Player marker: Bright green arrow with soft translucent view cone
 * - Building footprints & street grid
 * - Planting spots: Hollow pulsing green rings (available), filled green (planted), amber (withering)
 * - Nearest spot highlight: Enlarged pulsing ring with expanding radar ping
 * - Water droplets: Pulsing cyan teardrops fading with lifetime
 * - Purge drones: Red directional triangles with faint scanning cones
 * - Smog: Purple translucent overlay sampled from cellular smog grid
 * - Edge indicators: Border pins pointing to off-screen nearest water drop & planting spot
 * - Reclaimed progress bar: Positioned right beneath the minimap with zero overlap
 * - Interaction: Hold 'Alt' to release mouse & click to set waypoint; scroll to cycle zoom levels
 * - Full Map Modal ('M' key): Pauses simulation, drag-to-pan, wheel zoom, layer filters & legend
 * - Persistent settings (North-up, zoom levels, layer filters) stored in localStorage
 */

const STORAGE_KEY = 'vz_map_settings';

export class MapSystem {
  constructor({ scene, camera, worldRegistry, waypointSystem, app = null }) {
    this.scene = scene;
    this.camera = camera;
    this.registry = worldRegistry;
    this.waypointSystem = waypointSystem;
    this.app = app; // Reference to main app for pausing if available

    // Settings & State
    this.settings = this.loadSettings();
    this.zoomLevels = [
      { name: '0.8x', radius: 55, scale: 2.0 },   // Close
      { name: '1.0x', radius: 95, scale: 1.15 },  // Medium (Default)
      { name: '1.5x', radius: 160, scale: 0.68 }  // Far
    ];
    this.zoomIndex = this.settings.zoomIndex ?? 1;

    // Full Map State
    this.isFullMapOpen = false;
    this.fullMapPan = { x: 0, z: 0 };
    this.fullMapZoom = 1.0;
    this.isDraggingFullMap = false;
    this.dragStart = { x: 0, y: 0 };
    this.dragStartPan = { x: 0, z: 0 };

    // Minimap Render Timing (Throttled to 30 FPS)
    this.lastRenderTime = 0;
    this.renderInterval = 1000 / 30; // ~33.3ms
    this.simTime = 0;

    // Interaction State
    this.isAltDown = false;

    // Offscreen Canvas for Fast Smog Grid Blitting
    this.initSmogCanvas();

    // DOM Hierarchy
    this.initDOM();
    this.initEventListeners();

    // Ensure CSS is loaded even if bundler skips CSS imports
    this.ensureStyleInjected();
  }

  // =========================================================================
  // PERSISTENCE (LOCAL STORAGE)
  // =========================================================================

  loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('MapSystem: Failed to load settings from localStorage', e);
    }
    return {
      isNorthUp: false,
      zoomIndex: 1,
      filters: {
        spots: true,
        water: true,
        smog: true,
        drones: true,
        vines: true
      }
    };
  }

  saveSettings() {
    try {
      const data = {
        isNorthUp: this.settings.isNorthUp,
        zoomIndex: this.zoomIndex,
        filters: this.settings.filters
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('MapSystem: Failed to save settings to localStorage', e);
    }
  }

  ensureStyleInjected() {
    if (!document.querySelector('link[href*="map.css"]') && !document.getElementById('vz-map-style-fallback')) {
      const link = document.createElement('link');
      link.id = 'vz-map-style-fallback';
      link.rel = 'stylesheet';
      link.href = './src/styles/map.css';
      document.head.appendChild(link);
    }
  }

  // =========================================================================
  // OFFSCREEN SMOG TEXTURE BUFFER
  // =========================================================================

  initSmogCanvas() {
    this.smogCanvas = document.createElement('canvas');
    this.smogCanvas.width = 64;
    this.smogCanvas.height = 64;
    this.smogCtx = this.smogCanvas.getContext('2d');
    this.smogImageData = this.smogCtx.createImageData(64, 64);
  }

  updateSmogTexture() {
    const smogGrid = this.registry.smog.grid;
    if (!smogGrid) return;

    const data = this.smogImageData.data;
    const len = 64 * 64;

    for (let i = 0; i < len; i++) {
      const density = smogGrid[i] || 0;
      const pIdx = i * 4;
      if (density > 0.02) {
        // Toxic violet/purple smog: rgb(150, 45, 185)
        data[pIdx] = 150;
        data[pIdx + 1] = 45;
        data[pIdx + 2] = 185;
        data[pIdx + 3] = Math.min(220, Math.floor(density * 210));
      } else {
        data[pIdx + 3] = 0;
      }
    }

    this.smogCtx.putImageData(this.smogImageData, 0, 0);
  }

  // =========================================================================
  // DOM CREATION (MINIMAP CONTAINER & FULL MAP MODAL)
  // =========================================================================

  initDOM() {
    // ----------------------------------------------------
    // 1. MINIMAP ROOT CONTAINER (Top-Left 220px)
    // ----------------------------------------------------
    let container = document.getElementById('vz-minimap-root');
    if (!container) {
      container = document.createElement('div');
      container.id = 'vz-minimap-root';
      container.className = 'vz-minimap-container';

      container.innerHTML = `
        <div class="vz-minimap-topbar">
          <div class="vz-minimap-title">
            <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#00ff88; box-shadow:0 0 6px #00ff88;"></span>
            <span>RADAR</span>
          </div>
          <div class="vz-minimap-controls">
            <button id="vz-btn-north" class="vz-minimap-btn ${this.settings.isNorthUp ? 'active' : ''}" title="Toggle North-Up Orientation">N</button>
            <span id="vz-minimap-zoom-label" class="vz-minimap-zoom-badge">${this.zoomLevels[this.zoomIndex].name}</span>
            <button id="vz-btn-open-fullmap" class="vz-minimap-btn" title="Open Full Sector Map (M)">M</button>
          </div>
        </div>
        <canvas id="vz-minimap-canvas" class="vz-minimap-canvas" width="220" height="220"></canvas>
        <div class="vz-minimap-hint">Hold [Alt] to click • Scroll to zoom</div>
        <div class="vz-minimap-reclaimed-bar">
          <div class="vz-reclaimed-track">
            <div id="vz-reclaimed-fill" class="vz-reclaimed-fill" style="width: 0%;"></div>
          </div>
          <span id="vz-reclaimed-label" class="vz-reclaimed-text">0.0% RECLAIMED</span>
        </div>
      `;

      // Attach inside #gameplay-hud or body
      const hud = document.getElementById('gameplay-hud') || document.body;
      hud.appendChild(container);
    }

    this.minimapContainer = container;
    this.minimapCanvas = document.getElementById('vz-minimap-canvas');
    this.minimapCtx = this.minimapCanvas.getContext('2d');
    this.btnNorth = document.getElementById('vz-btn-north');
    this.btnFullMap = document.getElementById('vz-btn-open-fullmap');
    this.zoomLabel = document.getElementById('vz-minimap-zoom-label');
    this.reclaimedFill = document.getElementById('vz-reclaimed-fill');
    this.reclaimedLabel = document.getElementById('vz-reclaimed-label');

    // ----------------------------------------------------
    // 2. FULL MAP MODAL OVERLAY
    // ----------------------------------------------------
    let modal = document.getElementById('vz-fullmap-overlay');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'vz-fullmap-overlay';
      modal.className = 'vz-fullmap-overlay';
      modal.setAttribute('aria-hidden', 'true');

      modal.innerHTML = `
        <div class="vz-fullmap-panel">
          <div class="vz-fullmap-header">
            <div class="vz-fullmap-header-left">
              <h2 class="vz-fullmap-title">METROPOLIS SECTOR MAP</h2>
              <span id="vz-fullmap-coords" class="vz-fullmap-coords">SECTOR 01 • X: 0.0m Z: 0.0m</span>
            </div>
            <button id="vz-fullmap-close" class="vz-fullmap-close-btn" type="button">CLOSE [ESC / M]</button>
          </div>

          <div class="vz-fullmap-toolbar">
            <div class="vz-filter-group">
              <button class="vz-filter-btn active" data-filter="spots">
                <span class="vz-filter-dot" style="background:#00ff88;"></span> Planting Spots
              </button>
              <button class="vz-filter-btn active" data-filter="water">
                <span class="vz-filter-dot" style="background:#00d0ff;"></span> Water Droplets
              </button>
              <button class="vz-filter-btn active" data-filter="smog">
                <span class="vz-filter-dot" style="background:#a855f7;"></span> Smog Density
              </button>
              <button class="vz-filter-btn active" data-filter="drones">
                <span class="vz-filter-dot" style="background:#ff0033;"></span> Purge Drones
              </button>
              <button class="vz-filter-btn active" data-filter="vines">
                <span class="vz-filter-dot" style="background:#05df72;"></span> Active Vines
              </button>
            </div>

            <div class="vz-fullmap-actions">
              <button id="vz-btn-center-player" class="vz-action-btn" type="button">⌖ Center on Player</button>
              <button id="vz-btn-zoom-in" class="vz-action-btn" type="button">+</button>
              <button id="vz-btn-zoom-out" class="vz-action-btn" type="button">-</button>
              <button id="vz-btn-zoom-reset" class="vz-action-btn" type="button">100%</button>
            </div>
          </div>

          <div class="vz-fullmap-canvas-container">
            <canvas id="vz-fullmap-canvas" class="vz-fullmap-canvas"></canvas>
          </div>

          <div class="vz-fullmap-footer">
            <div class="vz-fullmap-legend">
              <div class="vz-legend-item">
                <span class="vz-legend-icon" style="background:#00ff88;"></span> Player
              </div>
              <div class="vz-legend-item">
                <span class="vz-legend-icon" style="border:1.5px solid #00ff88; background:transparent;"></span> Available Spot
              </div>
              <div class="vz-legend-item">
                <span class="vz-legend-icon" style="background:#00ff88;"></span> Planted
              </div>
              <div class="vz-legend-item">
                <span class="vz-legend-icon" style="background:#ffaa00;"></span> Withering
              </div>
              <div class="vz-legend-item">
                <span class="vz-legend-icon" style="background:#00d0ff;"></span> Water Drop
              </div>
              <div class="vz-legend-item">
                <span class="vz-legend-icon" style="background:#ff0033;"></span> Threat Drone
              </div>
              <div class="vz-legend-item">
                <span class="vz-legend-icon" style="background:#00f0ff;"></span> Waypoint (Beacon)
              </div>
            </div>
            <div>Click map to place Waypoint • Drag to Pan • Scroll to Zoom</div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
    }

    this.fullMapModal = modal;
    this.fullMapCanvas = document.getElementById('vz-fullmap-canvas');
    this.fullMapCtx = this.fullMapCanvas.getContext('2d');
    this.fullMapCoords = document.getElementById('vz-fullmap-coords');
    this.btnCloseFullMap = document.getElementById('vz-fullmap-close');
    this.btnCenterPlayer = document.getElementById('vz-btn-center-player');

    this.updateFilterButtons();
  }

  updateFilterButtons() {
    const btns = this.fullMapModal.querySelectorAll('.vz-filter-btn');
    btns.forEach(btn => {
      const type = btn.getAttribute('data-filter');
      const active = !!this.settings.filters[type];
      btn.classList.toggle('active', active);
    });
  }

  // =========================================================================
  // EVENT LISTENERS & HOTKEYS
  // =========================================================================

  initEventListeners() {
    // 1. North-Up Button Toggle
    if (this.btnNorth) {
      this.btnNorth.addEventListener('click', (e) => {
        e.stopPropagation();
        this.settings.isNorthUp = !this.settings.isNorthUp;
        this.btnNorth.classList.toggle('active', this.settings.isNorthUp);
        this.saveSettings();
      });
    }

    // 2. Open Full Map Button
    if (this.btnFullMap) {
      this.btnFullMap.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openFullMap();
      });
    }

    // 3. Minimap Wheel Zoom
    if (this.minimapContainer) {
      this.minimapContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.deltaY < 0) {
          // Zoom in
          this.zoomIndex = Math.max(0, this.zoomIndex - 1);
        } else {
          // Zoom out
          this.zoomIndex = Math.min(this.zoomLevels.length - 1, this.zoomIndex + 1);
        }
        if (this.zoomLabel) {
          this.zoomLabel.textContent = this.zoomLevels[this.zoomIndex].name;
        }
        this.saveSettings();
      }, { passive: false });
    }

    // 4. Alt Key Detection for Releasing Mouse Look
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Alt') {
        this.isAltDown = true;
        if (document.pointerLockElement) {
          try { document.exitPointerLock?.(); } catch (err) {}
        }
      }

      // 'M' Key: Toggle Full Map Modal
      if (e.code === 'KeyM') {
        // Prevent toggle if in input
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        this.toggleFullMap();
      }

      // Escape or Tab closes Full Map Modal if open
      if ((e.code === 'Escape' || e.code === 'Tab') && this.isFullMapOpen) {
        e.preventDefault();
        e.stopPropagation();
        this.closeFullMap();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'Alt') {
        this.isAltDown = false;
      }
    });

    // 5. Minimap Click to Set Waypoint
    if (this.minimapCanvas) {
      this.minimapCanvas.addEventListener('click', (e) => {
        const rect = this.minimapCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const worldCoord = this.minimapPixelToWorld(mouseX, mouseY);
        if (worldCoord) {
          this.handleMapClickWaypoint(worldCoord.x, worldCoord.z);
        }
      });
    }

    // 6. Full Map Controls
    if (this.btnCloseFullMap) {
      this.btnCloseFullMap.addEventListener('click', () => this.closeFullMap());
    }

    if (this.btnCenterPlayer) {
      this.btnCenterPlayer.addEventListener('click', () => {
        this.fullMapPan.x = this.registry.player.position.x;
        this.fullMapPan.z = this.registry.player.position.z;
        this.fullMapZoom = 1.0;
        this.renderFullMap();
      });
    }

    const btnZoomIn = document.getElementById('vz-btn-zoom-in');
    const btnZoomOut = document.getElementById('vz-btn-zoom-out');
    const btnZoomReset = document.getElementById('vz-btn-zoom-reset');

    if (btnZoomIn) {
      btnZoomIn.addEventListener('click', () => {
        this.fullMapZoom = Math.min(3.5, this.fullMapZoom * 1.25);
        this.renderFullMap();
      });
    }
    if (btnZoomOut) {
      btnZoomOut.addEventListener('click', () => {
        this.fullMapZoom = Math.max(0.4, this.fullMapZoom / 1.25);
        this.renderFullMap();
      });
    }
    if (btnZoomReset) {
      btnZoomReset.addEventListener('click', () => {
        this.fullMapZoom = 1.0;
        this.renderFullMap();
      });
    }

    // Filter Buttons
    const filterBtns = this.fullMapModal.querySelectorAll('.vz-filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-filter');
        this.settings.filters[type] = !this.settings.filters[type];
        btn.classList.toggle('active', this.settings.filters[type]);
        this.saveSettings();
        this.renderFullMap();
      });
    });

    // Full Map Drag to Pan
    if (this.fullMapCanvas) {
      this.fullMapCanvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // Left mouse only
        this.isDraggingFullMap = true;
        this.dragStart.x = e.clientX;
        this.dragStart.y = e.clientY;
        this.dragStartPan.x = this.fullMapPan.x;
        this.dragStartPan.z = this.fullMapPan.z;
      });

      window.addEventListener('mousemove', (e) => {
        if (!this.isDraggingFullMap || !this.isFullMapOpen) return;
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;

        // Convert screen delta to world delta based on zoom
        const scale = (this.fullMapCanvas.width / 320) * this.fullMapZoom;
        this.fullMapPan.x = this.dragStartPan.x - dx / scale;
        this.fullMapPan.z = this.dragStartPan.z - dy / scale;

        this.renderFullMap();
      });

      window.addEventListener('mouseup', () => {
        this.isDraggingFullMap = false;
      });

      // Full Map Wheel Zoom
      this.fullMapCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 0.87;
        this.fullMapZoom = Math.max(0.4, Math.min(3.5, this.fullMapZoom * factor));
        this.renderFullMap();
      }, { passive: false });

      // Full Map Click to Set Waypoint (if not dragged)
      this.fullMapCanvas.addEventListener('click', (e) => {
        const dragDist = Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y);
        if (dragDist > 6) return; // Considered a drag, not a click

        const rect = this.fullMapCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const worldCoord = this.fullMapPixelToWorld(mouseX, mouseY);
        if (worldCoord) {
          this.handleMapClickWaypoint(worldCoord.x, worldCoord.z);
          this.renderFullMap();
        }
      });
    }

    // Window resize handler for full map canvas resolution
    window.addEventListener('resize', () => {
      if (this.isFullMapOpen) {
        this.resizeFullMapCanvas();
        this.renderFullMap();
      }
    });
  }

  // =========================================================================
  // FULL MAP MODAL TOGGLE & PAUSE INTEGRATION
  // =========================================================================

  toggleFullMap() {
    if (this.isFullMapOpen) {
      this.closeFullMap();
    } else {
      this.openFullMap();
    }
  }

  openFullMap() {
    this.isFullMapOpen = true;
    this.fullMapModal.classList.add('open');
    this.fullMapModal.setAttribute('aria-hidden', 'false');

    // Pause game
    if (this.app) {
      this.app.isPaused = true;
      if (this.app.engine) this.app.engine.isPaused = true;
    }

    // Center full map pan on current player position
    this.fullMapPan.x = this.registry.player.position.x;
    this.fullMapPan.z = this.registry.player.position.z;

    this.resizeFullMapCanvas();
    this.renderFullMap();
  }

  closeFullMap() {
    this.isFullMapOpen = false;
    this.fullMapModal.classList.remove('open');
    this.fullMapModal.setAttribute('aria-hidden', 'true');

    // Unpause game
    if (this.app) {
      this.app.isPaused = false;
      if (this.app.engine) this.app.engine.isPaused = false;
    }
  }

  resizeFullMapCanvas() {
    const container = this.fullMapModal.querySelector('.vz-fullmap-canvas-container');
    if (!container) return;
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 550;

    if (this.fullMapCanvas.width !== w || this.fullMapCanvas.height !== h) {
      this.fullMapCanvas.width = w;
      this.fullMapCanvas.height = h;
    }
  }

  // =========================================================================
  // COORDINATE TRANSFORMATIONS
  // =========================================================================

  minimapPixelToWorld(pixelX, pixelY) {
    const size = 220;
    const cx = size / 2;
    const cy = size / 2;
    const scale = this.zoomLevels[this.zoomIndex].scale;

    const dx = pixelX - cx;
    const dy = pixelY - cy;

    const playerPos = this.registry.player.position;
    const camAngle = this.settings.isNorthUp ? 0 : this.registry.player.cameraHeading;

    // Un-rotate
    const cos = Math.cos(camAngle);
    const sin = Math.sin(camAngle);

    const relX = (dx * cos - dy * sin) / scale;
    const relZ = (dx * sin + dy * cos) / scale;

    return {
      x: playerPos.x + relX,
      z: playerPos.z + relZ
    };
  }

  fullMapPixelToWorld(pixelX, pixelY) {
    const w = this.fullMapCanvas.width;
    const h = this.fullMapCanvas.height;
    const cx = w / 2;
    const cy = h / 2;

    const baseScale = (w / 320) * this.fullMapZoom;
    const dx = pixelX - cx;
    const dy = pixelY - cy;

    return {
      x: this.fullMapPan.x + dx / baseScale,
      z: this.fullMapPan.z + dy / baseScale
    };
  }

  handleMapClickWaypoint(worldX, worldZ) {
    if (!this.waypointSystem) return;

    // Check proximity to existing spots or water drops to snap
    let snappedEntity = null;
    let label = 'Waypoint';
    let type = 'CUSTOM';

    // Check spots
    for (const spot of this.registry.getSpots()) {
      if (Math.hypot(spot.x - worldX, spot.z - worldZ) < 6.0) {
        snappedEntity = spot;
        label = spot.type || 'Planting Spot';
        type = 'SPOT';
        worldX = spot.x;
        worldZ = spot.z;
        break;
      }
    }

    // Check water drops if no spot snapped
    if (!snappedEntity) {
      for (const drop of this.registry.getWaterDrops()) {
        if (Math.hypot(drop.x - worldX, drop.z - worldZ) < 5.0) {
          snappedEntity = drop;
          label = 'Water Drop';
          type = 'WATER';
          worldX = drop.x;
          worldZ = drop.z;
          break;
        }
      }
    }

    this.waypointSystem.setWaypoint({
      x: worldX,
      y: 0.2,
      z: worldZ,
      type,
      entity: snappedEntity,
      label
    });
  }

  // =========================================================================
  // MAIN UPDATE & 30 FPS RENDER LOOP
  // =========================================================================

  update(delta, gameTime) {
    this.simTime = gameTime;

    // Throttle minimap canvas draw to steady 30 FPS
    const now = performance.now();
    if (now - this.lastRenderTime >= this.renderInterval) {
      this.lastRenderTime = now;
      this.updateSmogTexture();
      this.renderMinimap();
      this.updateReclaimedBar();

      if (this.isFullMapOpen) {
        this.renderFullMap();
      }
    }
  }

  updateReclaimedBar() {
    const pct = this.registry.getReclaimedPercentage();
    if (this.reclaimedFill) {
      this.reclaimedFill.style.width = `${pct}%`;
    }
    if (this.reclaimedLabel) {
      this.reclaimedLabel.textContent = `${pct.toFixed(1)}% RECLAIMED`;
    }
  }

  // =========================================================================
  // MINIMAP DRAWING ROUTINE
  // =========================================================================

  renderMinimap() {
    const ctx = this.minimapCtx;
    const size = 220;
    const cx = size / 2;
    const cy = size / 2;
    const scale = this.zoomLevels[this.zoomIndex].scale;

    const playerPos = this.registry.player.position;
    const camAngle = this.settings.isNorthUp ? 0 : this.registry.player.cameraHeading;
    const rot = -camAngle;

    // Clear background
    ctx.clearRect(0, 0, size, size);

    // Save world coordinate transformation
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    // 1. Street Grid & Lanes
    this.drawStreets(ctx, playerPos, scale);

    // 2. Smog Overlay
    if (this.smogCanvas) {
      this.drawSmog(ctx, playerPos, scale);
    }

    // 3. Building Footprints
    this.drawBuildings(ctx, playerPos, scale);

    // 4. Active Vines
    this.drawVines(ctx, playerPos, scale);

    // 5. Planting Spots
    const nearestSpot = this.registry.getNearestAvailableSpot(playerPos)?.spot;
    this.drawPlantingSpots(ctx, playerPos, scale, nearestSpot);

    // 6. Water Drops
    this.drawWaterDrops(ctx, playerPos, scale);

    // 7. Purge Drones
    this.drawDrones(ctx, playerPos, scale);

    // 7.5 Updraft Steam Vents
    this.drawUpdraftVents(ctx, playerPos, scale);

    // 8. Active Waypoint Beacon Marker
    this.drawWaypointMarker(ctx, playerPos, scale);

    ctx.restore();

    // 9. Edge-of-Minimap Clamped Indicators (Nearest Water & Nearest Spot)
    this.drawMinimapEdgeIndicators(ctx, cx, cy, rot, scale, playerPos);

    // 10. Player Icon (Centered, Arrow + View Cone)
    this.drawPlayerIcon(ctx, cx, cy, camAngle);

    // 11. Subtle Vignette & Circular Frame Outline
    this.drawMinimapBorderOverlay(ctx, size);
  }

  // =========================================================================
  // FULL MAP DRAWING ROUTINE
  // =========================================================================

  renderFullMap() {
    const ctx = this.fullMapCtx;
    const w = this.fullMapCanvas.width;
    const h = this.fullMapCanvas.height;
    const cx = w / 2;
    const cy = h / 2;

    const scale = (w / 320) * this.fullMapZoom;
    const pan = this.fullMapPan;

    // Update coordinate header readout
    if (this.fullMapCoords) {
      const p = this.registry.player.position;
      this.fullMapCoords.textContent = `PLAYER: X: ${p.x.toFixed(1)}m | Z: ${p.z.toFixed(1)}m — ZOOM: ${(this.fullMapZoom * 100).toFixed(0)}%`;
    }

    ctx.clearRect(0, 0, w, h);

    // Background slate
    ctx.fillStyle = '#080a14';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(cx, cy);

    // 1. Street Grid
    this.drawStreets(ctx, pan, scale);

    // 2. Smog Grid Overlay
    if (this.settings.filters.smog && this.smogCanvas) {
      this.drawSmog(ctx, pan, scale);
    }

    // 3. Buildings
    this.drawBuildings(ctx, pan, scale);

    // 4. Vines
    if (this.settings.filters.vines) {
      this.drawVines(ctx, pan, scale);
    }

    // 5. Spots
    if (this.settings.filters.spots) {
      const nearestSpot = this.registry.getNearestAvailableSpot(this.registry.player.position)?.spot;
      this.drawPlantingSpots(ctx, pan, scale, nearestSpot);
    }

    // 6. Water Drops
    if (this.settings.filters.water) {
      this.drawWaterDrops(ctx, pan, scale);
    }

    // 7. Drones
    if (this.settings.filters.drones) {
      this.drawDrones(ctx, pan, scale);
    }

    // 7.5 Updraft Steam Vents
    this.drawUpdraftVents(ctx, pan, scale);

    // 8. Active Waypoint
    this.drawWaypointMarker(ctx, pan, scale);

    // 9. Player Icon on Full Map
    const px = (this.registry.player.position.x - pan.x) * scale;
    const pz = (this.registry.player.position.z - pan.z) * scale;
    this.drawPlayerIcon(ctx, px, pz, 0, true);

    ctx.restore();

    // Map Center Crosshair Reticle
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 15, cy); ctx.lineTo(cx + 15, cy);
    ctx.moveTo(cx, cy - 15); ctx.lineTo(cx, cy + 15);
    ctx.stroke();
  }

  // =========================================================================
  // DRAWING PRIMITIVES
  // =========================================================================

  drawStreets(ctx, centerPos, scale) {
    // Main avenue along X=0
    const streetWidth = 16 * scale;
    const minZ = (-160 - centerPos.z) * scale;
    const maxZ = (160 - centerPos.z) * scale;
    const roadX = (0 - centerPos.x) * scale - streetWidth / 2;

    // Road asphalt corridor
    ctx.fillStyle = '#0f1220';
    ctx.fillRect(roadX, minZ, streetWidth, maxZ - minZ);

    // Double amber center divider
    ctx.strokeStyle = 'rgba(255, 170, 0, 0.45)';
    ctx.lineWidth = Math.max(1, 1.5 * (scale / 1.5));
    ctx.beginPath();
    const cx = (0 - centerPos.x) * scale;
    ctx.moveTo(cx - 1, minZ); ctx.lineTo(cx - 1, maxZ);
    ctx.moveTo(cx + 1, minZ); ctx.lineTo(cx + 1, maxZ);
    ctx.stroke();

    // Cyan lane marking borders
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(roadX, minZ); ctx.lineTo(roadX, maxZ);
    ctx.moveTo(roadX + streetWidth, minZ); ctx.lineTo(roadX + streetWidth, maxZ);
    ctx.stroke();

    // Cross avenues (Z = -70, Z = 0, Z = 70)
    const crossAvenues = [-70, 0, 70];
    ctx.fillStyle = '#0f1220';
    crossAvenues.forEach(zVal => {
      const crossY = (zVal - centerPos.z) * scale - 6 * scale;
      ctx.fillRect((-160 - centerPos.x) * scale, crossY, 320 * scale, 12 * scale);
    });
  }

  drawSmog(ctx, centerPos, scale) {
    // World size is 320 (-160 to +160)
    const worldX = (-160 - centerPos.x) * scale;
    const worldZ = (-160 - centerPos.z) * scale;
    const size = 320 * scale;

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.smogCanvas, worldX, worldZ, size, size);
    ctx.restore();
  }

  drawBuildings(ctx, centerPos, scale) {
    const buildings = this.registry.getBuildings();

    ctx.fillStyle = '#141829';
    ctx.strokeStyle = '#202640';
    ctx.lineWidth = 1;

    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      const bx = (b.minX - centerPos.x) * scale;
      const bz = (b.minZ - centerPos.z) * scale;
      const bw = b.w * scale;
      const bd = b.d * scale;

      // Fast AABB frustum cull against 240px bounds
      if (bx > 160 || bx + bw < -160 || bz > 160 || bz + bd < -160) {
        continue;
      }

      ctx.fillRect(bx, bz, bw, bd);
      ctx.strokeRect(bx, bz, bw, bd);
    }
  }

  drawVines(ctx, centerPos, scale) {
    const vines = this.registry.getVines();
    if (!vines || vines.length === 0) return;

    ctx.fillStyle = '#05df72';
    for (const v of vines) {
      const vx = (v.x - centerPos.x) * scale;
      const vz = (v.z - centerPos.z) * scale;

      ctx.beginPath();
      ctx.arc(vx, vz, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawPlantingSpots(ctx, centerPos, scale, nearestSpot) {
    const spots = this.registry.getSpots();
    const t = this.simTime;

    for (const s of spots) {
      const sx = (s.x - centerPos.x) * scale;
      const sz = (s.z - centerPos.z) * scale;

      if (s.isPlanted) {
        if (s.isWithering) {
          // Amber withering dot
          ctx.fillStyle = '#ffaa00';
          ctx.beginPath();
          ctx.arc(sx, sz, 4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Planted solid green dot
          ctx.fillStyle = '#00ff88';
          ctx.beginPath();
          ctx.arc(sx, sz, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Available spot: hollow pulsing green ring
        const isNearest = nearestSpot && nearestSpot.id === s.id;
        const pulse = 1.0 + 0.25 * Math.sin(t * 4.0);
        const radius = (isNearest ? 5.5 : 4.0) * pulse;

        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = isNearest ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.arc(sx, sz, radius, 0, Math.PI * 2);
        ctx.stroke();

        // Expanding ping radar ring for nearest available spot
        if (isNearest) {
          const pingPhase = (t * 1.5) % 1.0;
          const pingRadius = 5.0 + pingPhase * 10.0;
          ctx.strokeStyle = `rgba(0, 255, 136, ${1.0 - pingPhase})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(sx, sz, pingRadius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }

  drawWaterDrops(ctx, centerPos, scale) {
    const drops = this.registry.getWaterDrops();
    const t = this.simTime;

    for (const d of drops) {
      const dx = (d.x - centerPos.x) * scale;
      const dz = (d.z - centerPos.z) * scale;

      // Pulse size and lifetime fade
      const pulse = 0.85 + 0.2 * Math.sin(t * 5.0);
      const alpha = Math.max(0.3, Math.min(1.0, (d.lifetime || 15) / (d.maxLifetime || 15)));

      ctx.save();
      ctx.translate(dx, dz);
      ctx.scale(pulse, pulse);
      ctx.globalAlpha = alpha;

      // Draw droplet teardrop icon
      ctx.fillStyle = '#00d0ff';
      ctx.beginPath();
      ctx.arc(0, 1, 3.5, 0, Math.PI);
      ctx.lineTo(0, -5);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
  }

  drawDrones(ctx, centerPos, scale) {
    const drones = this.registry.getDrones();

    for (const d of drones) {
      const dx = (d.x - centerPos.x) * scale;
      const dz = (d.z - centerPos.z) * scale;

      ctx.save();
      ctx.translate(dx, dz);
      ctx.rotate(-d.heading);

      // Faint scan cone
      ctx.fillStyle = 'rgba(255, 0, 50, 0.16)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 16 * scale, -0.4, 0.4);
      ctx.closePath();
      ctx.fill();

      // Red drone triangle
      ctx.fillStyle = '#ff0033';
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(4, 4);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
  }

  drawUpdraftVents(ctx, centerPos, scale) {
    if (!this.app || !this.app.updraftSystem) return;
    const vents = this.app.updraftSystem.getVents();
    const t = this.simTime;

    ctx.save();
    for (const v of vents) {
      const vx = (v.x - centerPos.x) * scale;
      const vz = (v.z - centerPos.z) * scale;

      // Draw glowing cyan circle with upward chevron "^"
      const pulse = 1.0 + 0.15 * Math.sin(t * 5.0 + v.x);
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(vx, vz, 4.5 * pulse, 0, Math.PI * 2);
      ctx.stroke();

      // Cyan up-arrow chevron
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(vx - 2.5, vz + 1.5);
      ctx.lineTo(vx, vz - 2.5);
      ctx.lineTo(vx + 2.5, vz + 1.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawWaypointMarker(ctx, centerPos, scale) {
    if (!this.waypointSystem || !this.waypointSystem.activeWaypoint) return;

    const wp = this.waypointSystem.activeWaypoint.position;
    const wx = (wp.x - centerPos.x) * scale;
    const wz = (wp.z - centerPos.z) * scale;

    ctx.save();
    ctx.translate(wx, wz);

    // Glowing cyan crosshair and beacon diamond
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-5, -5, 10, 10);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fill();

    // Pulse ring
    const ring = 6 + (Math.sin(this.simTime * 5.0) + 1) * 3;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(0, 0, ring, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  drawPlayerIcon(ctx, x, y, camAngle, isFullMap = false) {
    ctx.save();
    ctx.translate(x, y);

    // Arrow heading rotation
    const arrowAngle = this.settings.isNorthUp || isFullMap ? -this.registry.player.cameraHeading : 0;
    ctx.rotate(arrowAngle);

    // Soft View Cone (Translucent fan displaying camera FOV ~60°)
    const coneGrad = ctx.createRadialGradient(0, 0, 2, 0, -22, 26);
    coneGrad.addColorStop(0, 'rgba(0, 255, 136, 0.35)');
    coneGrad.addColorStop(1, 'rgba(0, 255, 136, 0.0)');
    ctx.fillStyle = coneGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 28, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    ctx.closePath();
    ctx.fill();

    // Bright Green Player Arrow
    ctx.fillStyle = '#00ff88';
    ctx.shadowColor = 'rgba(0, 255, 136, 0.8)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  drawMinimapEdgeIndicators(ctx, cx, cy, rot, scale, playerPos) {
    const boundaryRadius = 96;

    // Helper to calculate edge-clamped screen position
    const clampToBorder = (worldPos) => {
      const relX = worldPos.x - playerPos.x;
      const relZ = worldPos.z - playerPos.z;

      // Rotate by rot
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const px = (relX * cos - relZ * sin) * scale;
      const py = (relX * sin + relZ * cos) * scale;

      const dist = Math.hypot(px, py);
      if (dist > boundaryRadius) {
        const angle = Math.atan2(py, px);
        return {
          isOffscreen: true,
          x: cx + Math.cos(angle) * boundaryRadius,
          y: cy + Math.sin(angle) * boundaryRadius,
          angle
        };
      }
      return { isOffscreen: false };
    };

    // 1. Edge indicator for nearest water drop
    const nearestWater = this.registry.getNearestWaterDrop(playerPos)?.drop;
    if (nearestWater) {
      const edge = clampToBorder(nearestWater);
      if (edge.isOffscreen) {
        ctx.save();
        ctx.translate(edge.x, edge.y);
        ctx.rotate(edge.angle);

        // Blue chevron arrow
        ctx.fillStyle = '#00d0ff';
        ctx.beginPath();
        ctx.moveTo(4, 0);
        ctx.lineTo(-4, -3.5);
        ctx.lineTo(-2, 0);
        ctx.lineTo(-4, 3.5);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      }
    }

    // 2. Edge indicator for nearest available planting spot
    const nearestSpot = this.registry.getNearestAvailableSpot(playerPos)?.spot;
    if (nearestSpot) {
      const edge = clampToBorder(nearestSpot);
      if (edge.isOffscreen) {
        ctx.save();
        ctx.translate(edge.x, edge.y);
        ctx.rotate(edge.angle);

        // Green chevron arrow
        ctx.fillStyle = '#00ff88';
        ctx.beginPath();
        ctx.moveTo(4, 0);
        ctx.lineTo(-4, -3.5);
        ctx.lineTo(-2, 0);
        ctx.lineTo(-4, 3.5);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      }
    }
  }

  drawMinimapBorderOverlay(ctx, size) {
    // Subtle circular inner border & cross reticles
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 98, 0, Math.PI * 2);
    ctx.stroke();

    // Center cross reticle ticks
    const cx = size / 2;
    const cy = size / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy);
    ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5);
    ctx.stroke();
  }

  dispose() {
    if (this.minimapContainer && this.minimapContainer.parentNode) {
      this.minimapContainer.parentNode.removeChild(this.minimapContainer);
    }
    if (this.fullMapModal && this.fullMapModal.parentNode) {
      this.fullMapModal.parentNode.removeChild(this.fullMapModal);
    }
  }
}
