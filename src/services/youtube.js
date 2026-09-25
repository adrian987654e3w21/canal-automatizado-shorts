import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { google } from 'googleapis';
import config from '../config.js';

function youtubeClient() {
  const auth = new google.auth.OAuth2(
    config.youtube.clientId || '',
    config.youtube.clientSecret || '',
    config.youtube.redirectUri,
  );

  if (config.youtube.refreshToken) {
    auth.setCredentials({ refresh_token: config.youtube.refreshToken });
  }

  if (config.youtube.accessToken) {
    auth.setCredentials({ access_token: config.youtube.accessToken });
  }

  return google.youtube({ version: 'v3', auth });
}

function buildDescription(content) {
  return [content.description, config.youtube.descriptionFooter]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 5000);
}

function buildTags(generatedTags) {
  const tags = [];
  let totalLength = 0;

  for (const tag of [...generatedTags, ...config.youtube.defaultTags]) {
    const clean = String(tag).replace(/^#/, '').replace(/\s+/g, ' ').trim();
    if (!clean || tags.some((existing) => existing.toLocaleLowerCase() === clean.toLocaleLowerCase())) continue;
    if (totalLength + clean.length > 500) continue;
    tags.push(clean);
    totalLength += clean.length;
  }

  return tags;
}

export async function publishToYouTube({ videoFile, content }) {
  const file = await stat(videoFile);
  if (file.size === 0) throw new Error('El MP4 que se intenta publicar esta vacio.');

  const requestBody = {
    snippet: {
      title: content.title.trim().slice(0, 100),
      description: buildDescription(content),
      tags: buildTags(content.tags),
      categoryId: config.youtube.categoryId,
    },
    status: {
      privacyStatus: config.youtube.privacy,
      selfDeclaredMadeForKids: config.youtube.madeForKids,
      embeddable: config.youtube.embeddable,
    },
  };

  const youtube = youtubeClient();
  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    notifySubscribers: false,
    requestBody,
    media: {
      mimeType: 'video/mp4',
      body: createReadStream(videoFile),
    },
  });

  if (!response.data.id) {
    throw new Error('YouTube acepto la solicitud, pero no devolvio un ID de video.');
  }

  let playlistItem = null;
  if (config.youtube.playlistId) {
    const playlistResponse = await youtube.playlistItems.insert({
      part: ['snippet'],
      requestBody: {
        snippet: {
          playlistId: config.youtube.playlistId,
          resourceId: {
            kind: 'youtube#video',
            videoId: response.data.id,
          },
        },
      },
    });
    playlistItem = playlistResponse.data?.id ?? null;
  }

  return {
    videoId: response.data.id,
    url: `https://www.youtube.com/watch?v=${response.data.id}`,
    title: response.data.snippet?.title ?? content.title,
    privacyStatus: response.data.status?.privacyStatus ?? config.youtube.privacy,
    uploadStatus: response.data.status?.uploadStatus ?? null,
    playlistItemId: playlistItem,
  };
}
