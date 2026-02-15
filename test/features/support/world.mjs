import { World, setWorldConstructor } from '@cucumber/cucumber';

class SchedulerWorld extends World {
  constructor(options) {
    super(options);
    /** @type {Array<{car_number: number, name: string}>} */
    this.participants = [];
    /** @type {number} */
    this.laneCount = 6;
    /** @type {Array} */
    this.results = [];
    /** @type {Object} */
    this.options = {};
    /** @type {Object|null} */
    this.schedule = null;
    /** @type {Error|null} */
    this.error = null;
    /** @type {string|null} */
    this.algorithmSelected = null;
    /** @type {Object|null} */
    this.laneBalance = null;
    /** @type {number} */
    this.currentHeatNumber = 0;
  }

  /**
   * Create N participants with sequential car numbers and generated names.
   * @param {number} count
   */
  createParticipants(count) {
    this.participants = [];
    for (let i = 1; i <= count; i++) {
      this.participants.push({ car_number: i, name: `Participant ${i}` });
    }
  }

  /**
   * Create named participants from a data table.
   * @param {Array<{car_number: string, name: string}>} rows
   */
  createNamedParticipants(rows) {
    this.participants = rows.map(row => ({
      car_number: parseInt(row.car_number, 10),
      name: row.name
    }));
  }
}

setWorldConstructor(SchedulerWorld);
