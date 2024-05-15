import sha1 from 'sha1';

import { v4 as uuidv4 } from 'uuid';

import redisClient from '../utils/redis';

import dbClient from '../utils/db';

export default class AuthController {
  static async getConnect(request, response) {
    const encodedData = request.get('Authorization');
    if (!encodedData) {
      return response.status(401).json({ error: 'Unauthorized' });
    }
    const decodedData = Buffer.from(encodedData.split(' ')[1], 'base64').toString();
    const dataArray = decodedData.split(':');
    if (dataArray.length !== 2) {
      return response.status(401).json({ error: 'Unauthorized' });
    }
    const hashPassword = sha1(dataArray[1]);
    const query = { email: dataArray[0], password: hashPassword };
    const user = await dbClient.usersCollection.findOne(query);
    if (user) {
      const token = uuidv4();
      const key = `auth_${token}`;
      const value = user._id.toString();
      const duration = 60 * 60 * 24;
      await redisClient.set(key, value, duration);
      return response.status(200).json({ token });
    }
    return response.status(401).json({ error: 'Unauthorized' });
  }

  static async getDisconnect(request, response) {
    const token = request.get('X-Token');
    if (!token) {
      return response.status(401).json({ error: 'Unauthorized' });
    }
    const key = `auth_${token}`;
    const id = await redisClient.get(key);
    if (id) {
      await redisClient.del(key);
      return response.status(204).json({});
    }
    return response.status(401).json({ error: 'Unauthorized' });
  }
}
