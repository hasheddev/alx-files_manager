import redisClient from '../utils/redis';

import dbClient from '../utils/db';

export default class AppController {
  static async getStatus(request, response) {
    const redis = await redisClient.isAlive();
    const db = await dbClient.isAlive();
    response.status(200).json({ redis, db });
  }

  static async getStats(request, response) {
    const users = await dbClient.nbUsers();
    const files = await dbClient.nbFiles();
    response.status(200).json({ users, files });
  }
}
