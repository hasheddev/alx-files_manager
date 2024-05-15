import { MongoClient } from 'mongodb';

const database = process.env.DB_DATABASE || 'files_manager';
const host = process.env.DB_HOST || 'localhost';
const port = process.env.DB_PORT || 27017;
const url = `mongodb://${host}:${port}`;

class DBClient {
  constructor() {
    const object = { useUnifiedTopology: true };
    this.client = new MongoClient(url, object);
    this.client.connect().then(() => {
      this.db = this.client.db(database);
      this.filesCollection = this.db.collection('files');
      this.usersCollection = this.db.collection('users');
    });
  }

  isAlive() {
    return this.client.isConnected();
  }

  async nbUsers() {
    const userCount = await this.usersCollection.countDocuments();
    return userCount;
  }

  async nbFiles() {
    const fileCount = await this.filesCollection.countDocuments();
    return fileCount;
  }
}

const dbClient = new DBClient();

export default dbClient;
