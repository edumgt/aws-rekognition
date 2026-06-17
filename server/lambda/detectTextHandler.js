const { getRekognition } = require('../src/awsClients');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': 'https://www.naver.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function decodeBase64Image(value) {
  if (!value) throw new Error('Missing required field: imageBase64');
  return Buffer.from(value, 'base64');
}

exports.handler = async (event = {}) => {
  // CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS' || event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  try {
    const payload = typeof event.body === 'string' ? JSON.parse(event.body) : event;
    const imageBytes = decodeBase64Image(payload.imageBase64);

    const rekognition = getRekognition();
    const data = await rekognition
      .detectText({ Image: { Bytes: imageBytes } })
      .promise();

    const textDetections = (data.TextDetections || []).map((entry) => ({
      detectedText: entry.DetectedText,
      type: entry.Type,
      confidence: Number(entry.Confidence.toFixed(2)),
    }));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ count: textDetections.length, textDetections }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: error.message }),
    };
  }
};
