import Queue from 'bull';
import { v4 as uuidv4 } from 'uuid';
import mime from 'mime-types';
import { ObjectID } from 'mongodb';
import { promises as fs } from 'fs';

import redisClient from '../utils/redis';
import dbClient from '../utils/db';

async function getUser(token) {
  if (!token) {
    return null;
  }
  const key = `auth_${token}`;
  const userId = await redisClient.get(key);
  if (userId) {
    const user = await dbClient.usersCollection.findOne({ _id: new ObjectID(userId) });
    if (user) {
      return user;
    }
  }
  return null;
}

async function sendFile(request, response, file) {
  let success = false;
  try {
    const fileSize = request.query.size;
    const { localPath } = file;
    const filePath = (fileSize) ? `${localPath}_${fileSize}` : localPath;
    const fileContent = await fs.readFile(filePath);
    const header = mime.contentType(file.name);
    response.header('Content-Type', header).status(200).send(fileContent);
    success = true;
  } catch (err) {
    console.log(err);
  }
  return success;
}

const fileQueue = new Queue('fileQueue', 'redis://127.0.0.1:6379');

export default class FilesController {
  static async postUpload(request, response) {
    const user = await getUser(request.header('X-Token'));
    if (!user) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const { name } = request.body;
    const { type } = request.body;
    const { parentId } = request.body;
    const { data } = request.body;
    const isPublic = request.body.isPublic || false;
    if (!name) {
      return response.status(400).json({ error: 'Missing name' });
    }
    if (!type) {
      return response.status(400).json({ error: 'Missing type' });
    }
    if (type !== 'folder' && !data) {
      return response.status(400).json({ error: 'Missing data' });
    }
    if (parentId !== undefined) {
      const file = await dbClient.filesCollection.findOne({ parentId, userId: user._id });
      if (!file) {
        return response.status(400).json({ error: 'Parent not found' });
      }
      if (file.type !== 'folder') {
        return response.status(400).json({ error: 'Parent is not a folder' });
      }
    }
    if (type === 'folder') {
      const newDocument = {
        userId: user._id,
        name,
        type,
        isPublic,
        parentId: parentId || 0,
      };
      dbClient.filesCollection.insertOne(newDocument)
        .then((result) => response.status(201).json({
          id: result.insertedId,
          ...newDocument,
        })).catch((error) => console.log(error));
    } else {
      const filePath = process.env.FOLDER_PATH || '/tmp/files_manager';
      const fullPath = `${filePath}/${uuidv4()}`;
      const decodedData = Buffer.from(data, 'base64');
      try {
        try {
          await fs.mkdir(filePath);
        } catch (error) {
          // Already existing folder
        }
        await fs.writeFile(fullPath, decodedData, 'utf-8');
      } catch (error) {
        console.log(error);
      }
      const newFile = {
        userId: user._id,
        name,
        type,
        isPublic,
        parentId: parentId || 0,
        localPath: fullPath,
      };
      dbClient.filesCollection.insertOne(newFile)
        .then((result) => {
          response.status(201).json({
            id: result.insertedId,
            ...newFile,
          });
          if (type === 'image') {
            fileQueue.add({ userId: user._id, fileId: result.insertedId });
          }
        }).catch((error) => console.log(error));
    }
    return null;
  }

  static async getShow(request, response) {
    const user = await getUser(request.header('X-Token'));
    if (!user) {
      return response.status(401).json({ error: 'Unauthorized' });
    }
    const fileId = request.params.id;
    const _id = new ObjectID(fileId);
    const file = await dbClient.filesCollection.findOne({ userId: user._id, _id });
    if (file) {
      return response.status(200).json(file);
    }
    return response.status(404).json({ error: 'Not found' });
  }

  static async getIndex(request, response) {
    const user = await getUser(request.header('X-Token'));
    if (!user) {
      return response.status(401).json({ error: 'Unauthorized' });
    }
    const { page, parentId } = request.query;
    const requstedPage = page || 0;
    const pageNum = parseInt(requstedPage, 10);
    const query = (parentId) ? { userId: user._id, parentId } : { userId: user._id };
    const pipelines = [
      { $match: query },
      { $sort: { _id: -1 } },
      {
        $facet: {
          sortMetadata: [{ $count: 'total' }, { $addFields: { page: pageNum } }],
          files: [{ $skip: 20 * pageNum }, { $limit: 20 }],
        },
      },
    ];
    dbClient.filesCollection.aggregate(pipelines).toArray((err, result) => {
      if (!result) {
        console.log(`An error occured ${err}`);
        return response.status(404).json({ error: 'Not found' });
      }
      const processedFiles = result[0].files.map((file) => {
        const tmp = { id: file._id, ...file };
        delete tmp._id;
        delete tmp.localPath;
        return tmp;
      });
      return response.status(200).json(processedFiles);
    });
    return null;
  }

  static async putPublish(request, response) {
    const user = await getUser(request.header('X-Token'));
    if (!user) {
      return response.status(401).json({ error: 'Unauthorized' });
    }
    const fileId = request.params.id;
    const _id = new ObjectID(fileId);
    const query = { userId: user._id, _id };
    const update = { $set: { isPublic: true } };
    const options = { returnOriginal: false };
    dbClient.filesCollection.findOneAndUpdate(query, update, options, (err, file) => {
      if (!file.lastErrorObject.updatedExisting) {
        return response.status(404).json({ error: 'Not found' });
      }
      const tmp = file.value;
      const id = tmp._id;
      const newFile = { id, ...tmp };
      delete newFile._id;
      return response.status(200).json(newFile);
    });
    return null;
  }

  static async putUnpublish(request, response) {
    const user = await getUser(request.header('X-Token'));
    if (!user) {
      return response.status(401).json({ error: 'Unauthorized' });
    }
    const fileId = request.params.id;
    const _id = new ObjectID(fileId);
    const query = { userId: user._id, _id };
    const update = { $set: { isPublic: false } };
    const options = { returnOriginal: false };
    dbClient.filesCollection.findOneAndUpdate(query, update, options, (err, file) => {
      if (!file.lastErrorObject.updatedExisting) {
        return response.status(404).json({ error: 'Not found' });
      }
      const tmp = file.value;
      const id = tmp._id;
      const newFile = { id, ...tmp };
      delete newFile._id;
      return response.status(200).json(newFile);
    });
    return null;
  }

  static async getFile(request, response) {
    const fileId = request.params.id;
    const _id = new ObjectID(fileId);
    const file = await dbClient.filesCollection.findOne({ _id });
    if (!file) {
      return response.status(404).json({ error: 'Not found' });
    }
    if (file.isPublic) {
      if (file.type === 'folder') {
        return response.status(400).json({ error: "A folder doesn't have content" });
      }
      const success = await sendFile(request, response, file);
      if (success === false) {
        return response.status(404).json({ error: 'Not found' });
      }
    } else {
      const user = await getUser(request.header('X-Token'));
      if (!user || user._id.toString() !== file.userId.toString()) {
        return response.status(404).json({ error: 'Not found' });
      }
      if (file.type === 'folder') {
        response.status(400).json({ error: "A folder doesn't have content" });
      } else {
        const sent = await sendFile(request, response, file);
        if (sent === false) {
          return response.status(404).json({ error: 'Not found' });
        }
      }
    }
    return null;
  }
}
