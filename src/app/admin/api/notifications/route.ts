import { createNotificationsGetHandler, createNotificationsPostHandler } from './handler';

export const dynamic = 'force-dynamic';

export const GET = createNotificationsGetHandler();
export const POST = createNotificationsPostHandler();
