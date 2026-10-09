import * as THREE from 'three';

/**
 * WorldRegistry
 * Read-only snapshot of the world used by the minimap, sector map and waypoints.
 * The app syncs it from the live systems at 10 Hz; records are updated in place
 * so syncing does not allocate per call.
 */
export class WorldRegistry {
  constructor() {
    this.spots = new Map();       // id -> { id, x, y, z, type, isPlanted, isWithering }
    this.waterDrops = new Map();  // id -> { id, x, y, z, lifetime, maxLifetime }
    this.drones = new Map();      // id -> { id, x, y, z, state, heading }
    this.vines = [];              // [{ x, z, health }]
    this.buildings = [];
    this.shelters = [];
    this.smog = { grid: null, gridSize: 64, worldSize: 320 };
    this.player = { position: new THREE.Vector3(), heading: 0, cameraHeading: 0 };
    this.totalSpots = 1;
    this.plantedCount = 0;
    this.reclaimedPercentage = 0;
    this._listeners = new Map();
    this._forward = new THREE.Vector3();
    this._seen = new Set();
  }

  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(cb);
    return () => this._listeners.get(event)?.delete(cb);
  }

  emit(event, payload) {
    this._listeners.get(event)?.forEach(cb => {
      try { cb(payload); } catch (err) { console.error(`WorldRegistry listener error [${event}]:`, err); }
    });
  }

  reset() {
    this.waterDrops.clear();
    this.drones.clear();
    this.vines.length = 0;
    for (const s of this.spots.values()) {
      s.isPlanted = false;
      s.isWithering = false;
    }
    this.plantedCount = 0;
    this.reclaimedPercentage = 0;
  }

  syncFromWorld({ city, plantSystem, smogSystem, droneSystem, survival, robot, cameraController }) {
    if (city && this.buildings.length === 0) {
      this.buildings = city.buildingColliders
        .filter(c => !c.isPlatform)
        .map(c => ({ minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ, w: c.maxX - c.minX, d: c.maxZ - c.minZ, height: c.height }));
      this.shelters = (city.shelters || []).map(s => ({ ...s, w: s.maxX - s.minX, d: s.maxZ - s.minZ }));
    }

    // Planting spots
    if (city?.spotMeshes) {
      let planted = 0;
      for (const sp of city.spotMeshes) {
        const id = sp.data.id;
        let rec = this.spots.get(id);
        if (!rec) {
          rec = { id, x: sp.data.x, y: sp.data.y, z: sp.data.z, type: sp.data.type, isPlanted: false, isWithering: false };
          this.spots.set(id, rec);
        }
        rec.isPlanted = sp.isPlanted;
        rec.isWithering = sp.isWithering;
        if (sp.isPlanted) planted++;
      }
      this.totalSpots = Math.max(1, city.spotMeshes.length);
      this.plantedCount = planted;
    }
    if (plantSystem) {
      this.reclaimedPercentage = plantSystem.reclaimedPercentage;
      this.vines.length = 0;
      for (const v of plantSystem.activeVines) this.vines.push({ x: v.pos.x, z: v.pos.z, health: v.health });
    }

    // Water drops
    if (survival) {
      this._seen.clear();
      for (const d of survival.waterDrops) {
        this._seen.add(d.id);
        let rec = this.waterDrops.get(d.id);
        if (!rec) {
          rec = { id: d.id, x: 0, y: 0, z: 0, lifetime: 0, maxLifetime: d.maxLife };
          this.waterDrops.set(d.id, rec);
        }
        rec.x = d.group.position.x;
        rec.y = d.group.position.y;
        rec.z = d.group.position.z;
        rec.lifetime = d.life;
      }
      for (const id of this.waterDrops.keys()) {
        if (!this._seen.has(id)) this.waterDrops.delete(id);
      }
    }

    // Drones
    if (droneSystem) {
      this._seen.clear();
      for (const dr of droneSystem.drones) {
        this._seen.add(dr.id);
        let rec = this.drones.get(dr.id);
        if (!rec) {
          rec = { id: dr.id, x: 0, y: 0, z: 0, state: '', heading: 0 };
          this.drones.set(dr.id, rec);
        }
        rec.x = dr.position.x;
        rec.y = dr.position.y;
        rec.z = dr.position.z;
        rec.state = dr.state;
        rec.heading = dr.group.rotation.y;
      }
      for (const id of this.drones.keys()) {
        if (!this._seen.has(id)) this.drones.delete(id);
      }
    }

    if (smogSystem) {
      this.smog.grid = smogSystem.grid;
      this.smog.gridSize = smogSystem.gridSize;
      this.smog.worldSize = smogSystem.worldSize;
    }

    if (robot) {
      this.player.position.copy(robot.position);
      this.player.heading = robot.mesh.rotation.y;
    }
    if (cameraController) {
      cameraController.camera.getWorldDirection(this._forward);
      this.player.cameraHeading = Math.atan2(this._forward.x, -this._forward.z);
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  getSpots() { return this.spots.values(); }
  getSpotById(id) { return this.spots.get(id) || null; }
  getWaterDrops() { return this.waterDrops.values(); }
  getDrones() { return this.drones.values(); }
  getVines() { return this.vines; }
  getBuildings() { return this.buildings; }
  getShelters() { return this.shelters; }

  getNearestAvailableSpot(pos) {
    let best = null, bestSq = Infinity;
    for (const s of this.spots.values()) {
      if (s.isPlanted) continue;
      const dSq = (s.x - pos.x) ** 2 + (s.z - pos.z) ** 2;
      if (dSq < bestSq) { bestSq = dSq; best = s; }
    }
    return best ? { spot: best, distance: Math.sqrt(bestSq) } : null;
  }

  getNearestWaterDrop(pos) {
    let best = null, bestSq = Infinity;
    for (const d of this.waterDrops.values()) {
      const dSq = (d.x - pos.x) ** 2 + (d.z - pos.z) ** 2;
      if (dSq < bestSq) { bestSq = dSq; best = d; }
    }
    return best ? { drop: best, distance: Math.sqrt(bestSq) } : null;
  }

  getReclaimedPercentage() {
    return this.reclaimedPercentage;
  }
}
