import sha1 from 'sha1';
import Queue from 'bull';
import { ObjectID } from 'mongodb';
import redisClient from '../utils/redis';
import dbClient from '../utils/db';

const userQueue = new Queue('userQueue', 'redis://127.0.0.1:6379');

export default class UsersController {
  static async postNew(request, response) {
    const { email } = request.body;
    const { password } = request.body;

    if (!email) {
      return response.status(400).json({ error: 'Missing email' });
    }
    if (!password) {
      return response.status(400).json({ error: 'Missing password' });
    }

    let user = await dbClient.usersCollection.findOne({ email });
    if (user) {
      return response.status(400).json({ error: 'Already exist' });
    }
    const hashPassword = sha1(password);
    try {
      user = await dbClient.usersCollection.insertOne({ email, password: hashPassword });
      userQueue.add({ id: user.insertedId });
      response.status(201).json({ id: user.insertedId, email });
    } catch (error) {
      console.log(error);
    }
    return null;
  }

  static async getMe(request, response) {
    const token = request.get('X-Token');
    if (!token) {
      return response.status(401).json({ error: 'Unauthorized' });
    }
    const key = `auth_${token}`;
    const userId = await redisClient.get(key);
    if (userId) {
      const user = await dbClient.usersCollection.findOne({ _id: new ObjectID(userId) });
      if (user) {
        return response.status(200).json({ id: userId, email: user.email });
      }
      return response.status(401).json({ error: 'Unauthorized' });
    }
    return response.status(401).json({ error: 'Unauthorized' });
  }
}
