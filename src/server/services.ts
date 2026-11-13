import 'server-only';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { validateRuntimeConfig } from '../config/runtime';
import { ReadingCache } from '../readings/server/cache';
import { localCatalog, s3Catalog } from '../readings/server/sources';
import {
  createReadingService,
  type ReadingService
} from '../readings/server/service';
import { InMemoryShareRepository } from '../shares/server/storage/memory-repository';
import { DynamoDbShareRepository } from '../shares/server/storage/dynamodb-repository';
import type { ShareRepository } from '../shares/server/storage/repository';
import { QuotaService } from './abuse/quotas';
import { DynamoQuotaBackend } from './abuse/dynamodb-quotas';
import { MemoryQuotaBackend } from './abuse/memory-quotas';

type Environment = Readonly<Record<string, string | undefined>>;
type Immutable<T> = {
  readonly [Key in keyof T]: T[Key] extends object ? Immutable<T[Key]> : T[Key];
};
function freeze<T extends object>(value: T): Immutable<T> {
  for (const child of Object.values(value))
    if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value) as Immutable<T>;
}
export interface ServiceOverrides {
  shares?: ShareRepository;
  readings?: ReadingService;
  quotas?: QuotaService;
}
/** Snapshot and validate nonsecret settings once; external connections and catalog reads remain lazy. */
export function createServerServices(
  environment: Environment,
  overrides: ServiceOverrides = {}
) {
  const config = freeze(validateRuntimeConfig(environment));
  const quotaRegion = environment.DYNAMODB_REGION ?? environment.AWS_REGION;
  const localQuotas =
    config.storage.SHARE_PERSISTENCE === 'memory' &&
    (environment.NODE_ENV !== 'production' ||
      environment.QUOTA_LOCAL_ONLY === 'true');
  let shares = overrides.shares,
    readings = overrides.readings,
    quotas = overrides.quotas;
  return {
    config,
    features: config.features,
    get shares(): ShareRepository {
      const storage = config.storage;
      return (shares ??=
        storage.SHARE_PERSISTENCE === 'memory'
          ? new InMemoryShareRepository()
          : DynamoDbShareRepository.forRegion(
              storage.DYNAMODB_TABLE_NAME,
              storage.DYNAMODB_REGION
            ));
    },
    get readings(): ReadingService {
      if (!readings) {
        const source = config.readings;
        const cache = new ReadingCache(
          source.READINGS_SOURCE === 'local'
            ? localCatalog(source.READINGS_LOCAL_PATH)
            : s3Catalog(
                source.READINGS_S3_BUCKET,
                source.READINGS_S3_KEY,
                new S3Client({ region: source.READINGS_REGION })
              ),
          {
            sample: source.READINGS_SAMPLE === 'true',
            requireComplete: config.deployment === 'prod'
          }
        );
        readings = createReadingService(cache);
      }
      return readings;
    },
    get quotas(): QuotaService {
      if (!quotas) {
        const table = config.quotas.tableName;
        const backend = table
          ? new DynamoQuotaBackend(
              table,
              DynamoDBDocumentClient.from(
                new DynamoDBClient({
                  region: quotaRegion,
                  maxAttempts: 2,
                  requestHandler: {
                    connectionTimeout: 2000,
                    requestTimeout: 5000
                  }
                })
              )
            )
          : localQuotas
            ? new MemoryQuotaBackend()
            : undefined;
        if (!backend) throw new Error('quota backend required');
        quotas = new QuotaService(
          backend,
          () => Date.now(),
          config.quotas.policy
        );
      }
      return quotas;
    }
  };
}
export type ServerServices = ReturnType<typeof createServerServices>;
const processState = globalThis as typeof globalThis & {
  doorknobRuntime?: { services?: ServerServices; overrides?: ServiceOverrides };
};
/** One process-local instance, retained across Next development reloads. Tests create explicit instances. */
export function getServerServices(): ServerServices {
  const runtime = (processState.doorknobRuntime ??= {});
  return (runtime.services ??= createServerServices(
    process.env,
    runtime.overrides
  ));
}
