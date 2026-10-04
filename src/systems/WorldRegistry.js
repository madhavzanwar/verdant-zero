import * as THREE from 'three';

/**
 * WorldRegistry
 * Single source of truth holding all planting spots, water drops, buildings,
 * vines, drones, and smog grid data in Verdant Zero.
 * 
 * Provides spatial queries, registration, and live synchronisation methods
 * used by both the game simulation and the map/navigation systems.
 */
export class WorldRegistry {
  constructor() {
    // Entities
    this.spots = new Map();         // id -> SpotRecord
    this.waterDrops = new Map();    // id -> WaterRecord
    this.buildings = [];            // Array of BuildingRecord
    this.vines = new Map();         // id -> VineRecord
    this.drones = new Map();        // id -> DroneRecord

    // Smog Simulation Reference
    this.smog = {
      grid: null,
      gridSize: 64,
      worldSize: 320,
      cellSize: 5,
      getDensity: (x, z) => 0
    };

    // Player & Camera State
    this.player = {
      position: new THREE.Vector3(0, 0, 0),
      heading: 0,          // Radians (robot movement facing direction)
      cameraHeading: 0,    // Radians (camera look horizontal angle)
      isAlive: true
    };

    // Event bus for reactivity
    this._listeners = new Map();

    // Cache metrics
    this.totalSpots = 6;
    this.plantedCount = 0;
    this._nextDropId = 1;
    this._nextDroneId = 1;
  }

  // =========================================================================
  // EVENT BUS
  // =========================================================================

  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this._listeners.has(event)) {
      this._listeners.get(event).delete(callback);
    }
  }

  emit(event, payload) {
    if (this._listeners.has(event)) {
      for (const cb of this._listeners.get(event)) {
        try {
          cb(payload);
        } catch (err) {
          console.error(`WorldRegistry event listener error [${event}]:`, err);
        }
      }
    }
  }

  // =========================================================================
  // REGISTRATION & MUTATION: PLANTING SPOTS
  // =========================================================================

  /**
   * Register or update a planting spot.
   * Spot structure:
   * { id, x, y, z, type, isPlanted, isWithering, health, mesh, spotRef }
   */
  registerSpot(spot) {
    const id = spot.id !== undefined ? spot.id : this.spots.size;
    const existing = this.spots.get(id) || {};

    const record = {
      id,
      x: spot.x ?? spot.position?.x ?? existing.x ?? 0,
      y: spot.y ?? spot.position?.y ?? existing.y ?? 0,
      z: spot.z ?? spot.position?.z ?? existing.z ?? 0,
      type: spot.type ?? existing.type ?? `Spot ${id}`,
      isPlanted: spot.isPlanted !== undefined ? spot.isPlanted : (existing.isPlanted || false),
      isWithering: spot.isWithering !== undefined ? spot.isWithering : (existing.isWithering || false),
      health: spot.health !== undefined ? spot.health : (existing.health ?? 1.0),
      mesh: spot.mesh || existing.mesh || null,
      spotRef: spot.spotRef || spot
    };

    this.spots.set(id, record);
    this.recomputeSpotMetrics();
    this.emit('spot:updated', record);
    return record;
  }

  updateSpot(id, updates) {
    const spot = this.spots.get(id);
    if (!spot) return null;

    Object.assign(spot, updates);
    this.recomputeSpotMetrics();
    this.emit('spot:updated', spot);
    return spot;
  }

  setSpots(spotsArray) {
    this.spots.clear();
    spotsArray.forEach((s, idx) => {
      this.registerSpot({ ...s, id: s.id ?? idx });
    });
    this.recomputeSpotMetrics();
    this.emit('spots:reset', this.getSpots());
  }

  recomputeSpotMetrics() {
    this.totalSpots = Math.max(1, this.spots.size);
    let planted = 0;
    for (const spot of this.spots.values()) {
      if (spot.isPlanted) planted++;
    }
    this.plantedCount = planted;
  }

  // =========================================================================
  // REGISTRATION & MUTATION: WATER DROPS
  // =========================================================================

  /**
   * Register a water drop entity.
   * { id, x, y, z, lifetime, maxLifetime, group, mesh }
   */
  registerWaterDrop(drop) {
    const id = drop.id !== undefined ? drop.id : `drop_${this._nextDropId++}`;
    const x = drop.x ?? drop.pos?.x ?? drop.position?.x ?? drop.group?.position?.x ?? 0;
    const y = drop.y ?? drop.pos?.y ?? drop.position?.y ?? drop.group?.position?.y ?? 0;
    const z = drop.z ?? drop.pos?.z ?? drop.position?.z ?? drop.group?.position?.z ?? 0;

    const record = {
      id,
      x, y, z,
      lifetime: drop.lifetime ?? 15.0,
      maxLifetime: drop.maxLifetime ?? 15.0,
      group: drop.group || null,
      mesh: drop.sphere || drop.mesh || null,
      dropRef: drop
    };

    this.waterDrops.set(id, record);
    this.emit('water:added', record);
    return record;
  }

  removeWaterDrop(idOrDrop) {
    let id = idOrDrop;
    if (typeof idOrDrop === 'object' && idOrDrop !== null) {
      id = idOrDrop.id;
      if (!id) {
        // Search by dropRef
        for (const [k, v] of this.waterDrops.entries()) {
          if (v.dropRef === idOrDrop || v.group === idOrDrop.group) {
            id = k;
            break;
          }
        }
      }
    }

    if (id && this.waterDrops.has(id)) {
      const removed = this.waterDrops.get(id);
      this.waterDrops.delete(id);
      this.emit('water:removed', removed);
      return removed;
    }
    return null;
  }

  setWaterDrops(dropsArray) {
    this.waterDrops.clear();
    for (const d of dropsArray) {
      this.registerWaterDrop(d);
    }
    this.emit('water:reset', this.getWaterDrops());
  }

  // =========================================================================
  // REGISTRATION & MUTATION: BUILDINGS & CITY FOOTPRINTS
  // =========================================================================

  registerBuilding(b) {
    const minX = b.minX !== undefined ? b.minX : (b.x - (b.w || 10) / 2);
    const maxX = b.maxX !== undefined ? b.maxX : (b.x + (b.w || 10) / 2);
    const minZ = b.minZ !== undefined ? b.minZ : (b.z - (b.d || 10) / 2);
    const maxZ = b.maxZ !== undefined ? b.maxZ : (b.z + (b.d || 10) / 2);
    const width = b.w !== undefined ? b.w : (maxX - minX);
    const depth = b.d !== undefined ? b.d : (maxZ - minZ);
    const height = b.height !== undefined ? b.height : (b.y || 40);
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;

    const record = {
      id: b.id || `b_${this.buildings.length}`,
      minX, maxX, minZ, maxZ,
      x: centerX,
      z: centerZ,
      w: width,
      d: depth,
      height,
      layer: b.layer || 1
    };

    this.buildings.push(record);
    return record;
  }

  setBuildings(buildingsArray) {
    this.buildings = [];
    for (const b of buildingsArray) {
      this.registerBuilding(b);
    }
    this.emit('buildings:reset', this.buildings);
  }

  // =========================================================================
  // REGISTRATION & MUTATION: DRONES & VINES
  // =========================================================================

  registerDrone(drone) {
    const id = drone.id !== undefined ? drone.id : `drone_${this._nextDroneId++}`;
    const x = drone.position?.x ?? drone.group?.position?.x ?? 0;
    const y = drone.position?.y ?? drone.group?.position?.y ?? 0;
    const z = drone.position?.z ?? drone.group?.position?.z ?? 0;

    const record = {
      id,
      x, y, z,
      state: drone.state || 'SEEKING',
      heading: drone.heading || 0,
      scanAngle: drone.scanAngle || 0.6,
      targetVine: drone.targetVine || null,
      droneRef: drone
    };

    this.drones.set(id, record);
    this.emit('drone:added', record);
    return record;
  }

  removeDrone(idOrDrone) {
    let id = idOrDrone;
    if (typeof idOrDrone === 'object' && idOrDrone !== null) {
      id = idOrDrone.id;
      if (!id) {
        for (const [k, v] of this.drones.entries()) {
          if (v.droneRef === idOrDrone || v.droneRef?.group === idOrDrone.group) {
            id = k;
            break;
          }
        }
      }
    }
    if (id && this.drones.has(id)) {
      const removed = this.drones.get(id);
      this.drones.delete(id);
      this.emit('drone:removed', removed);
      return removed;
    }
    return null;
  }

  registerVine(vine) {
    const id = vine.id !== undefined ? vine.id : `vine_${this.vines.size}`;
    const record = {
      id,
      x: vine.pos?.x ?? vine.x ?? 0,
      y: vine.pos?.y ?? vine.y ?? 0,
      z: vine.pos?.z ?? vine.z ?? 0,
      growth: vine.growth ?? 1.0,
      health: vine.health ?? 1.0,
      isInsideSmog: !!vine.isInsideSmog,
      vineRef: vine
    };
    this.vines.set(id, record);
    return record;
  }

  // =========================================================================
  // SMOG GRID & PLAYER STATE
  // =========================================================================

  setSmogSystem(smogSystem) {
    if (!smogSystem) return;
    this.smog = {
      grid: smogSystem.grid,
      gridSize: smogSystem.gridSize || 64,
      worldSize: smogSystem.worldSize || 320,
      cellSize: smogSystem.cellSize || 5,
      getDensity: (x, z) => (smogSystem.getDensityAt ? smogSystem.getDensityAt(x, z) : (smogSystem.getDensity ? smogSystem.getDensity(x, z) : 0)),
      systemRef: smogSystem
    };
  }

  setSmogGrid(grid, gridSize = 64, worldSize = 320) {
    this.smog.grid = grid;
    this.smog.gridSize = gridSize;
    this.smog.worldSize = worldSize;
    this.smog.cellSize = worldSize / gridSize;
    this.smog.getDensity = (x, z) => {
      const gx = Math.floor((x + worldSize / 2) / this.smog.cellSize);
      const gz = Math.floor((z + worldSize / 2) / this.smog.cellSize);
      if (gx < 0 || gx >= gridSize || gz < 0 || gz >= gridSize) return 0;
      return grid[gz * gridSize + gx] || 0;
    };
  }

  updatePlayer(pos, heading = 0, cameraHeading = 0) {
    if (pos) {
      this.player.position.copy(pos);
    }
    this.player.heading = heading;
    this.player.cameraHeading = cameraHeading;
  }

  // =========================================================================
  // LIVE WORLD SYNCHRONIZATION
  // =========================================================================

  /**
   * Seamlessly syncs registry data from active game systems.
   * Can be invoked each frame or at 30 FPS.
   */
  syncFromWorld({ city, plantSystem, smogSystem, droneSystem, survival, robot, cameraController }) {
    // 1. Sync city buildings if not registered yet
    if (city && this.buildings.length === 0) {
      if (city.buildingColliders && city.buildingColliders.length > 0) {
        this.setBuildings(city.buildingColliders);
      } else if (city.buildingPositions && city.buildingPositions.length > 0) {
        this.setBuildings(city.buildingPositions);
      }
    }

    // 2. Sync spots from city / plantSystem
    const sourceSpots = city?.spotMeshes || plantSystem?.city?.spotMeshes;
    if (sourceSpots && sourceSpots.length > 0) {
      sourceSpots.forEach((sp, idx) => {
        const id = sp.data?.id !== undefined ? sp.data.id : idx;
        const x = sp.data?.x ?? sp.mesh?.position?.x ?? 0;
        const y = sp.data?.y ?? sp.mesh?.position?.y ?? 0;
        const z = sp.data?.z ?? sp.mesh?.position?.z ?? 0;
        const type = sp.data?.type || `Spot ${id}`;
        const isPlanted = !!sp.isPlanted;

        // Check if spot is withering from connected vine
        let isWithering = false;
        let health = 1.0;
        if (plantSystem?.activeVines) {
          const connectedVine = plantSystem.activeVines.find(v => {
            return (v.pos && Math.hypot(v.pos.x - x, v.pos.z - z) < 1.5);
          });
          if (connectedVine) {
            health = connectedVine.health !== undefined ? connectedVine.health : 1.0;
            isWithering = health < 0.6 && isPlanted;
          }
        }

        const existing = this.spots.get(id);
        if (!existing || existing.isPlanted !== isPlanted || existing.isWithering !== isWithering || existing.health !== health) {
          this.registerSpot({
            id,
            x, y, z,
            type,
            isPlanted,
            isWithering,
            health,
            mesh: sp.mesh,
            spotRef: sp
          });
        }
      });
    }

    // 3. Sync water drops from survival
    if (survival && survival.waterDrops) {
      // Reconcile active droplets
      const liveDropRefs = new Set();
      survival.waterDrops.forEach((d, idx) => {
        liveDropRefs.add(d);
        const x = d.group?.position?.x ?? d.pos?.x ?? 0;
        const y = d.group?.position?.y ?? d.pos?.y ?? 0;
        const z = d.group?.position?.z ?? d.pos?.z ?? 0;
        const id = d.id !== undefined ? d.id : `survival_drop_${idx}`;

        const existing = this.waterDrops.get(id);
        if (!existing) {
          this.registerWaterDrop({ id, x, y, z, dropRef: d, group: d.group, mesh: d.sphere });
        } else {
          existing.x = x;
          existing.y = y;
          existing.z = z;
        }
      });

      // Remove drops that no longer exist in survival.waterDrops
      for (const [id, record] of this.waterDrops.entries()) {
        if (record.dropRef && !survival.waterDrops.includes(record.dropRef)) {
          this.waterDrops.delete(id);
          this.emit('water:removed', record);
        }
      }
    }

    // 4. Sync drones
    if (droneSystem && droneSystem.drones) {
      const liveDrones = new Set();
      droneSystem.drones.forEach((dr, idx) => {
        liveDrones.add(dr);
        const id = dr.id !== undefined ? dr.id : `drone_${idx}`;
        const x = dr.position?.x ?? dr.group?.position?.x ?? 0;
        const y = dr.position?.y ?? dr.group?.position?.y ?? 0;
        const z = dr.position?.z ?? dr.group?.position?.z ?? 0;
        
        // Calculate heading angle
        let heading = 0;
        if (dr.velocity && (dr.velocity.x !== 0 || dr.velocity.z !== 0)) {
          heading = Math.atan2(dr.velocity.x, dr.velocity.z);
        } else if (dr.group) {
          heading = dr.group.rotation.y;
        }

        const existing = this.drones.get(id);
        if (!existing) {
          this.registerDrone({
            id, x, y, z,
            state: dr.state || 'SEEKING',
            heading,
            targetVine: dr.targetVine,
            droneRef: dr
          });
        } else {
          existing.x = x;
          existing.y = y;
          existing.z = z;
          existing.state = dr.state || 'SEEKING';
          existing.heading = heading;
          existing.targetVine = dr.targetVine;
        }
      });

      for (const [id, record] of this.drones.entries()) {
        if (record.droneRef && !droneSystem.drones.includes(record.droneRef)) {
          this.drones.delete(id);
          this.emit('drone:removed', record);
        }
      }
    }

    // 5. Sync vines
    if (plantSystem && plantSystem.activeVines) {
      plantSystem.activeVines.forEach((v, idx) => {
        const id = `vine_${idx}`;
        this.registerVine({
          id,
          pos: v.pos,
          growth: v.growth,
          health: v.health ?? 1.0,
          isInsideSmog: v.isInsideSmog,
          vineRef: v
        });
      });
    }

    // 6. Sync smog system reference
    if (smogSystem && (!this.smog.grid || this.smog.systemRef !== smogSystem)) {
      this.setSmogSystem(smogSystem);
    }

    // 7. Sync player & camera
    if (robot && robot.position) {
      this.player.position.copy(robot.position);
      // Robot visual yaw or forward direction
      if (robot.mesh || robot.group) {
        this.player.heading = (robot.mesh || robot.group).rotation.y;
      }
    }

    if (cameraController && cameraController.camera) {
      // Camera azimuth angle
      const cam = cameraController.camera;
      const forward = new THREE.Vector3();
      cam.getWorldDirection(forward);
      // Angle in XZ plane (0 = facing -Z north, Math.PI/2 = east, etc.)
      this.player.cameraHeading = Math.atan2(forward.x, -forward.z);
    }
  }

  // =========================================================================
  // SPATIAL QUERIES
  // =========================================================================

  getSpots(filter = null) {
    const list = Array.from(this.spots.values());
    return filter ? list.filter(filter) : list;
  }

  getSpotById(id) {
    return this.spots.get(id) || null;
  }

  getAvailableSpots() {
    return this.getSpots(s => !s.isPlanted);
  }

  getPlantedSpots() {
    return this.getSpots(s => s.isPlanted);
  }

  getWitheringSpots() {
    return this.getSpots(s => s.isPlanted && s.isWithering);
  }

  /**
   * Find nearest planting spot to a coordinate.
   * Default filter finds nearest available (unplanted) spot.
   */
  getNearestPlantingSpot(pos, filterFn = (s) => !s.isPlanted) {
    let nearest = null;
    let minDistSq = Infinity;
    const px = pos.x ?? 0;
    const pz = pos.z ?? 0;

    for (const spot of this.spots.values()) {
      if (filterFn && !filterFn(spot)) continue;

      const dx = spot.x - px;
      const dz = spot.z - pz;
      const distSq = dx * dx + dz * dz;

      if (distSq < minDistSq) {
        minDistSq = distSq;
        nearest = spot;
      }
    }

    return nearest ? { spot: nearest, distance: Math.sqrt(minDistSq) } : null;
  }

  getNearestAvailableSpot(pos) {
    return this.getNearestPlantingSpot(pos, s => !s.isPlanted);
  }

  getWaterDrops() {
    return Array.from(this.waterDrops.values());
  }

  /**
   * Find nearest water drop to a coordinate.
   */
  getNearestWaterDrop(pos) {
    let nearest = null;
    let minDistSq = Infinity;
    const px = pos.x ?? 0;
    const pz = pos.z ?? 0;

    for (const drop of this.waterDrops.values()) {
      const dx = drop.x - px;
      const dz = drop.z - pz;
      const distSq = dx * dx + dz * dz;

      if (distSq < minDistSq) {
        minDistSq = distSq;
        nearest = drop;
      }
    }

    return nearest ? { drop: nearest, distance: Math.sqrt(minDistSq) } : null;
  }

  getDrones() {
    return Array.from(this.drones.values());
  }

  getNearestDrone(pos) {
    let nearest = null;
    let minDistSq = Infinity;
    const px = pos.x ?? 0;
    const pz = pos.z ?? 0;

    for (const drone of this.drones.values()) {
      const dx = drone.x - px;
      const dz = drone.z - pz;
      const distSq = dx * dx + dz * dz;

      if (distSq < minDistSq) {
        minDistSq = distSq;
        nearest = drone;
      }
    }

    return nearest ? { drone: nearest, distance: Math.sqrt(minDistSq) } : null;
  }

  getVines() {
    return Array.from(this.vines.values());
  }

  getBuildings() {
    return this.buildings;
  }

  getSmogDensity(x, z) {
    if (this.smog.getDensity) {
      return this.smog.getDensity(x, z);
    }
    return 0;
  }

  getSmogGrid() {
    return this.smog;
  }

  getReclaimedPercentage() {
    if (this.totalSpots <= 0) return 0;
    return Math.min(100, Math.round((this.plantedCount / this.totalSpots) * 1000) / 10);
  }

  /**
   * Query all entities within a 2D radius of a world point.
   */
  getEntitiesInRadius(pos, radius, types = ['spots', 'water', 'drones']) {
    const rSq = radius * radius;
    const px = pos.x ?? 0;
    const pz = pos.z ?? 0;
    const result = {
      spots: [],
      water: [],
      drones: []
    };

    if (types.includes('spots')) {
      for (const s of this.spots.values()) {
        const dSq = (s.x - px) ** 2 + (s.z - pz) ** 2;
        if (dSq <= rSq) result.spots.push(s);
      }
    }

    if (types.includes('water')) {
      for (const w of this.waterDrops.values()) {
        const dSq = (w.x - px) ** 2 + (w.z - pz) ** 2;
        if (dSq <= rSq) result.water.push(w);
      }
    }

    if (types.includes('drones')) {
      for (const d of this.drones.values()) {
        const dSq = (d.x - px) ** 2 + (d.z - pz) ** 2;
        if (dSq <= rSq) result.drones.push(d);
      }
    }

    return result;
  }
}

// Default export instance for shared singleton usage
export const worldRegistry = new WorldRegistry();
