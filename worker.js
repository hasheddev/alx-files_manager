import Queue from 'bull';
import { promises as fs } from 'fs';
import { ObjectID } from 'mongodb';
import imageThumbnail from 'image-thumbnail';
import dbClient from './utils/db';

const fileQueue = new Queue('fileQueue', 'redis://127.0.0.1:6379');

const userQueue = new Queue('userQueue', 'redis://127.0.0.1:6379');

async function createThumbnail(filePath, imageWidth) {
  const thumbnail = await imageThumbnail(filePath, { width: imageWidth });
  return thumbnail;
}

fileQueue.process(async (job, done) => {
  const { userId, fileId } = job.data;
  if (!fileId) {
    done(new Error('Missing fileId'));
  }
  if (!userId) {
    done(new Error('Missing userId'));
  }
  const _id = new ObjectID(fileId);
  const file = await dbClient.filesCollection.findOne({ _id });
  if (!file) {
    done(new Error('File not found'));
  } else {
    const filePath = file.localPath;
    const thumbnailLarge = await createThumbnail(filePath, 500);
    const thumbnailMedium = await createThumbnail(filePath, 250);
    const thumbnailSmall = await createThumbnail(filePath, 100);
    const largeImagePath = `${filePath}_500`;
    const mediumImagePath = `${filePath}_250`;
    const smallImagePath = `${filePath}_100`;
    const pathArray = [
      { path: largeImagePath, image: thumbnailLarge },
      { path: mediumImagePath, image: thumbnailMedium },
      { path: smallImagePath, image: thumbnailSmall },
    ];
    pathArray.forEach(async (object) => {
      await fs.writeFile(object.path, object.image);
    });
    done();
  }
});

userQueue.process(async (job, done) => {
  const { userId } = job.data;
  if (!userId) {
    done(new Error('Missing userId'));
  }
  const _id = new ObjectID(userId);
  const user = await dbClient.usersCollection.findOne({ _id });
  if (!user) {
    done(new Error('User not found'));
  } else {
    console.log(`Welcome ${user.email}`);
  }
});
