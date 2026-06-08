import { Client } from 'minio';

const ENDPOINT = process.env.MINIO_ENDPOINT;
const PORT = Number(process.env.MINIO_PORT);
const USE_SSL = process.env.MINIO_USE_SSL === 'true';
const ACCESS_KEY = process.env.MINIO_ACCESS_KEY;
const SECRET_KEY = process.env.MINIO_SECRET_KEY;
export const BUCKET_NAME = process.env.MINIO_BUCKET;
export const PUBLIC_URL = process.env.MINIO_PUBLIC_URL;

export const minioClient = new Client({
  endPoint: ENDPOINT,
  port: PORT,
  useSSL: USE_SSL,
  accessKey: ACCESS_KEY,
  secretKey: SECRET_KEY,
});

export async function ensureBucket() {
  try {
    const exists = await minioClient.bucketExists(BUCKET_NAME);
    if (exists) return;
    await minioClient.makeBucket(BUCKET_NAME);
    console.log('Bucket created:', BUCKET_NAME);
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${BUCKET_NAME}/*`],
        },
      ],
    };
    await minioClient.setBucketPolicy(BUCKET_NAME, JSON.stringify(policy));
  } catch (error) {
    console.error('ensureBucket failed:', error);
    throw error;
  }
}

export function buildPublicUrl(filename: string): string {
  return `${PUBLIC_URL}/${BUCKET_NAME}/${filename}`;
}
