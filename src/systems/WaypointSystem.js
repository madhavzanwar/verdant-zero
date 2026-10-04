import * as THREE from 'three';

/**
 * WaypointSystem
 * Manages 3D in-world beacons and 2D HUD indicators for user navigation.
 * 
 * Features:
 * - 3D glowing beacon column with ground pulse ring and bobbing beacon gem
 * - 2D HUD target marker (floating above target in camera frustum)
 * - 2D screen-edge pointer arrow with distance badge when off-screen
 * - Hotkeys: 'T' targets nearest water drop, 'G' targets nearest available planting spot
 * - Auto-clears when within 3 units or when target despawns / is planted
 * - Clean GPU resource management (MeshBasicMaterial + dispose on cleanup)
 */
export class WaypointSystem {
  constructor(scene, camera, worldRegistry, audio = null) {
    this.scene = scene;
    this.camera = camera;
    this.registry = worldRegistry;
    this.audio = audio;

    // Active Waypoint Data
    this.activeWaypoint = null;
    // { position: THREE.Vector3, type: 'SPOT'|'WATER'|'CUSTOM', entity: object|null, label: string }

    // 3D Visual Objects Group
    this.beaconGroup = null;
    this.beaconPillar = null;
    this.beaconRing = null;
    this.beaconGem = null;

    // 2D DOM HUD Elements
    this.initDOM();

    // Keybindings ('T' and 'G')
    this.initHotkeys();
  }

  // =========================================================================
  // DOM HUD INITIALIZATION
  // =========================================================================

  initDOM() {
    // 1. Screen-Edge Clamped Indicator
    this.edgeEl = document.getElementById('vz-waypoint-edge-indicator');
    if (!this.edgeEl) {
      this.edgeEl = document.createElement('div');
      this.edgeEl.id = 'vz-waypoint-edge-indicator';
      this.edgeEl.className = 'vz-waypoint-edge-indicator';
      this.edgeEl.style.display = 'none';

      this.edgeArrow = document.createElement('div');
      this.edgeArrow.className = 'vz-waypoint-arrow';

      this.edgeBadge = document.createElement('div');
      this.edgeBadge.className = 'vz-waypoint-badge';
      this.edgeBadge.textContent = '0m';

      this.edgeEl.appendChild(this.edgeArrow);
      this.edgeEl.appendChild(this.edgeBadge);
      document.body.appendChild(this.edgeEl);
    } else {
      this.edgeArrow = this.edgeEl.querySelector('.vz-waypoint-arrow');
      this.edgeBadge = this.edgeEl.querySelector('.vz-waypoint-badge');
    }

    // 2. On-Screen Floating Target Marker
    this.screenEl = document.getElementById('vz-waypoint-screen-marker');
    if (!this.screenEl) {
      this.screenEl = document.createElement('div');
      this.screenEl.id = 'vz-waypoint-screen-marker';
      this.screenEl.className = 'vz-waypoint-screen-marker';
      this.screenEl.style.display = 'none';

      this.screenDiamond = document.createElement('div');
      this.screenDiamond.className = 'vz-waypoint-diamond';

      this.screenBadge = document.createElement('div');
      this.screenBadge.className = 'vz-waypoint-screen-badge';
      this.screenBadge.textContent = '0m';

      this.screenEl.appendChild(this.screenDiamond);
      this.screenEl.appendChild(this.screenBadge);
      document.body.appendChild(this.screenEl);
    } else {
      this.screenDiamond = this.screenEl.querySelector('.vz-waypoint-diamond');
      this.screenBadge = this.screenEl.querySelector('.vz-waypoint-screen-badge');
    }
  }

  // =========================================================================
  // HOTKEYS ('T' FOR WATER, 'G' FOR PLANTING SPOT)
  // =========================================================================

  initHotkeys() {
    window.addEventListener('keydown', (e) => {
      // Ignore if user is typing in an input
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        return;
      }

      if (e.code === 'KeyT') {
        this.targetNearestWater();
      } else if (e.code === 'KeyG') {
        this.targetNearestFertileSpot();
      }
    });
  }

  targetNearestWater() {
    const playerPos = this.registry.player.position;
    const res = this.registry.getNearestWaterDrop(playerPos);
    if (res && res.drop) {
      this.setWaypoint({
        x: res.drop.x,
        y: res.drop.y,
        z: res.drop.z,
        type: 'WATER',
        entity: res.drop,
        label: 'Water Drop'
      });
      if (this.audio?.playChime) this.audio.playChime();
    }
  }

  targetNearestFertileSpot() {
    const playerPos = this.registry.player.position;
    const res = this.registry.getNearestAvailableSpot(playerPos);
    if (res && res.spot) {
      this.setWaypoint({
        x: res.spot.x,
        y: res.spot.y,
        z: res.spot.z,
        type: 'SPOT',
        entity: res.spot,
        label: res.spot.type || 'Planting Spot'
      });
      if (this.audio?.playChime) this.audio.playChime();
    }
  }

  // =========================================================================
  // WAYPOINT CREATION & CLEANUP
  // =========================================================================

  setWaypoint({ x, y = 0.2, z, type = 'CUSTOM', entity = null, label = 'Waypoint' }) {
    this.clearWaypoint();

    const pos = new THREE.Vector3(x, y, z);
    this.activeWaypoint = {
      position: pos,
      type,
      entity,
      label
    };

    this.create3DBeacon(pos, type);

    this.registry.emit('waypoint:set', this.activeWaypoint);
    return this.activeWaypoint;
  }

  clearWaypoint() {
    if (!this.activeWaypoint) return;

    this.activeWaypoint = null;
    this.remove3DBeacon();

    if (this.edgeEl) this.edgeEl.style.display = 'none';
    if (this.screenEl) this.screenEl.style.display = 'none';

    this.registry.emit('waypoint:cleared', null);
  }

  create3DBeacon(position, type) {
    const group = new THREE.Group();
    group.position.set(position.x, position.y, position.z);

    // Color theme
    let colorHex = 0x00f0ff; // Cyan default
    if (type === 'SPOT') colorHex = 0x00ff88;
    if (type === 'WATER') colorHex = 0x00d0ff;

    // 1. Glowing Vertical Light Column (Additive MeshBasicMaterial)
    const pillarHeight = 45;
    const pillarGeo = new THREE.CylinderGeometry(0.35, 0.45, pillarHeight, 16, 1, true);
    const pillarMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.y = pillarHeight / 2;
    group.add(pillar);
    this.beaconPillar = pillar;

    // 2. Ground Concentric Pulse Ring
    const ringGeo = new THREE.RingGeometry(0.8, 1.4, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    group.add(ring);
    this.beaconRing = ring;

    // 3. Floating Beacon Gem (Octahedron / Diamond)
    const gemGeo = new THREE.OctahedronGeometry(0.7, 0);
    const gemMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    const gem = new THREE.Mesh(gemGeo, gemMat);
    gem.position.y = 3.2;
    group.add(gem);
    this.beaconGem = gem;

    this.scene.add(group);
    this.beaconGroup = group;
  }

  remove3DBeacon() {
    if (!this.beaconGroup) return;

    this.scene.remove(this.beaconGroup);

    // Strict resource disposal adhering to UI Pro Max guideline
    this.beaconGroup.traverse(child => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });

    this.beaconGroup = null;
    this.beaconPillar = null;
    this.beaconRing = null;
    this.beaconGem = null;
  }

  // =========================================================================
  // UPDATE LOOP (3D ANIMATION, PROJECTION & AUTO-CLEAR)
  // =========================================================================

  update(delta, gameTime) {
    if (!this.activeWaypoint) return;

    const playerPos = this.registry.player.position;
    const targetPos = this.activeWaypoint.position;

    // 1. Distance Calculation
    const distSq = (playerPos.x - targetPos.x) ** 2 + (playerPos.z - targetPos.z) ** 2;
    const dist = Math.sqrt(distSq);

    // 2. Auto-Clear Checks:
    // A. Player within 3.0 units
    if (dist < 3.0) {
      this.clearWaypoint();
      return;
    }

    // B. Target entity was a planting spot and has now been planted
    if (this.activeWaypoint.type === 'SPOT' && this.activeWaypoint.entity) {
      const spotRec = this.registry.getSpotById(this.activeWaypoint.entity.id);
      if (spotRec && spotRec.isPlanted) {
        this.clearWaypoint();
        return;
      }
    }

    // C. Target entity was a water drop and has despawned / collected
    if (this.activeWaypoint.type === 'WATER' && this.activeWaypoint.entity) {
      const dropStillExists = this.registry.waterDrops.has(this.activeWaypoint.entity.id);
      if (!dropStillExists) {
        this.clearWaypoint();
        return;
      }
    }

    // 3. Animate 3D Beacon
    if (this.beaconGroup) {
      if (this.beaconRing) {
        const pulse = 1.0 + 0.3 * Math.sin(gameTime * 4.0);
        this.beaconRing.scale.set(pulse, pulse, 1);
        this.beaconRing.material.opacity = 0.6 + 0.35 * Math.sin(gameTime * 4.0);
      }
      if (this.beaconGem) {
        this.beaconGem.rotation.y += delta * 2.0;
        this.beaconGem.position.y = 3.2 + 0.35 * Math.sin(gameTime * 3.0);
      }
      if (this.beaconPillar) {
        this.beaconPillar.material.opacity = 0.35 + 0.15 * Math.sin(gameTime * 2.5);
      }
    }

    // 4. 2D HUD Projection (Screen vs Edge Pointer)
    this.updateHUD(targetPos, dist);
  }

  updateHUD(targetPos, distanceMeters) {
    if (!this.camera) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const distText = `${Math.round(distanceMeters)}m`;

    // 3D Point to Screen Projection
    const proj = targetPos.clone();
    proj.y += 2.0; // Anchor point slightly above ground
    proj.project(this.camera);

    // Vector from camera to target in world space to test behind camera
    const camPos = this.camera.position;
    const camForward = new THREE.Vector3();
    this.camera.getWorldDirection(camForward);
    const toTarget = targetPos.clone().sub(camPos);
    const isBehind = toTarget.dot(camForward) <= 0;

    // Convert NDC (-1 to 1) to screen pixels
    let screenX = (proj.x * 0.5 + 0.5) * w;
    let screenY = (-proj.y * 0.5 + 0.5) * h;

    const margin = 48;
    const isInView = !isBehind &&
      screenX >= margin &&
      screenX <= w - margin &&
      screenY >= margin &&
      screenY <= h - margin;

    if (isInView) {
      // Show floating on-screen marker
      if (this.screenEl) {
        this.screenEl.style.display = 'flex';
        this.screenEl.style.left = `${screenX}px`;
        this.screenEl.style.top = `${screenY}px`;
        if (this.screenBadge) this.screenBadge.textContent = distText;
      }
      if (this.edgeEl) {
        this.edgeEl.style.display = 'none';
      }
    } else {
      // Show screen-edge clamped arrow pointer
      if (this.screenEl) {
        this.screenEl.style.display = 'none';
      }
      if (this.edgeEl) {
        this.edgeEl.style.display = 'flex';

        // Calculate direction from screen center
        const centerX = w / 2;
        const centerY = h / 2;
        let dx = screenX - centerX;
        let dy = screenY - centerY;

        // Invert if behind camera
        if (isBehind) {
          dx = -dx;
          dy = -dy;
        }

        // Clamp to screen perimeter
        const slope = dy / (dx || 0.0001);
        const maxDx = (w / 2) - margin;
        const maxDy = (h / 2) - margin;

        let clampX, clampY;
        if (Math.abs(dx) * maxDy > Math.abs(dy) * maxDx) {
          clampX = dx > 0 ? maxDx : -maxDx;
          clampY = clampX * slope;
        } else {
          clampY = dy > 0 ? maxDy : -maxDy;
          clampX = clampY / slope;
        }

        const edgeX = centerX + clampX;
        const edgeY = centerY + clampY;

        this.edgeEl.style.left = `${edgeX}px`;
        this.edgeEl.style.top = `${edgeY}px`;

        // Rotate arrow to point towards target
        const angleRad = Math.atan2(dy, dx) + Math.PI / 2;
        if (this.edgeArrow) {
          this.edgeArrow.style.transform = `rotate(${angleRad}rad)`;
        }
        if (this.edgeBadge) {
          this.edgeBadge.textContent = distText;
        }
      }
    }
  }

  dispose() {
    this.clearWaypoint();
    if (this.edgeEl && this.edgeEl.parentNode) {
      this.edgeEl.parentNode.removeChild(this.edgeEl);
    }
    if (this.screenEl && this.screenEl.parentNode) {
      this.screenEl.parentNode.removeChild(this.screenEl);
    }
  }
}
