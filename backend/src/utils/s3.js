import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const BUCKET = process.env.S3_UPLOADS_BUCKET;

/**
 * Upload a file buffer to S3.
 * @param {Buffer} buffer - File contents
 * @param {string} key - S3 object key (e.g. "uploads/logo-abc123.png")
 * @param {string} contentType - MIME type
 * @returns {Promise<string>} The S3 object key
 */
export async function uploadFile(buffer, key, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return key;
}

/**
 * Generate a pre-signed URL for downloading/viewing a file.
 * @param {string} key - S3 object key
 * @param {number} expiresIn - URL validity in seconds (default 1 hour)
 * @returns {Promise<string>} Pre-signed URL
 */
export async function getPresignedUrl(key, expiresIn = 3600) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

/**
 * Delete a file from S3.
 * @param {string} key - S3 object key
 */
export async function deleteFile(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
