import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = process.env.AWS_S3_REGION;
const bucket = process.env.AWS_S3_BUCKET_NAME;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

if (!region || !bucket || !accessKeyId || !secretAccessKey) {
  throw new Error("Missing AWS S3 credentials in environment.");
}

const s3 = new S3Client({
  region,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

export async function uploadToS3(args: {
  key: string;
  contentType: string;
  body: Buffer;
}): Promise<void> {
  const { key, contentType, body } = args;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: "private",
    }),
  );
}

export async function getSignedGetUrl(args: { key: string; expiresInSeconds?: number }): Promise<string> {
  const { key, expiresInSeconds = 3600 } = args;
  return await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
    { expiresIn: expiresInSeconds },
  );
}

export async function deleteFromS3(args: { key: string }): Promise<void> {
  const { key } = args;
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}

export function s3KeyFromRecipeImage(householdId: string, recipeId: string): string {
  return `recipe-images/${householdId}/${recipeId}.jpg`;
}

export function s3KeyFromReceiptImage(householdId: string, receiptId: string): string {
  return `receipts/${householdId}/${receiptId}.jpg`;
}
