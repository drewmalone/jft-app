import 'server-only';
import type { ShareRepository } from './repository';
import { serverServices } from '../../../server/services';

/** Process-local wiring; the DynamoDB adapter shares durable data across instances. */
export const shareRepository: ShareRepository = {
  create: (ownerId, text, reading, submission) =>
    serverServices.shares.create(ownerId, text, reading, submission),
  findBySubmission: (ownerId, submission) =>
    serverServices.shares.findBySubmission(ownerId, submission),
  listByOwner: (ownerId, options) =>
    serverServices.shares.listByOwner(ownerId, options),
  findByOwner: (id, ownerId) => serverServices.shares.findByOwner(id, ownerId),
  findById: (id) => serverServices.shares.findById(id)
};
