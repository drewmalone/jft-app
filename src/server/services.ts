import 'server-only';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { parsePersistenceConfig, parseReadingsConfig } from '../config/runtime';
import { parseFeatureConfig } from '../config/features';
import { parseQuotaConfig } from '../config/quotas';
import { ReadingCache } from '../readings/server/cache';
import { localCatalog, s3Catalog } from '../readings/server/sources';
import { InMemoryShareRepository } from '../shares/server/storage/memory-repository';
import { DynamoDbShareRepository } from '../shares/server/storage/dynamodb-repository';
import type { ShareRepository } from '../shares/server/storage/repository';
import { QuotaService } from './abuse/quotas';
import { DynamoQuotaBackend } from './abuse/dynamodb-quotas';
import { MemoryQuotaBackend } from './abuse/memory-quotas';

type Environment = Readonly<Record<string, string | undefined>>;
interface ServiceState {
  doorknobShareRepository?: ShareRepository;
  dailyReadings?: ReadingCache;
  doorknobQuotas?: QuotaService;
  doorknobTranscriptionProvider?: ReturnType<
    typeof parseFeatureConfig
  >['transcription']['provider'];
}
export function createShareRepository(
  env: Environment = process.env
): ShareRepository {
  const config = parsePersistenceConfig(env);
  return config.SHARE_PERSISTENCE === 'memory'
    ? new InMemoryShareRepository()
    : DynamoDbShareRepository.forRegion(
        config.DYNAMODB_TABLE_NAME,
        config.DYNAMODB_REGION
      );
}
/** One wiring boundary. Factories are lazy, so builds never load catalogs, secrets or AWS data. */
export function createServerServices(
  env?: Environment,
  state: ServiceState = {}
) {
  const environment = () => env ?? process.env;
  return {
    get features() {
      const features = parseFeatureConfig(environment());
      state.doorknobTranscriptionProvider ??= features.transcription.provider;
      return {
        ...features,
        transcription: {
          ...features.transcription,
          provider: state.doorknobTranscriptionProvider
        }
      };
    },
    get shares() {
      return (state.doorknobShareRepository ??=
        createShareRepository(environment()));
    },
    get readings() {
      if (!state.dailyReadings) {
        const config = parseReadingsConfig(environment());
        state.dailyReadings = new ReadingCache(
          config.READINGS_SOURCE === 'local'
            ? localCatalog(config.READINGS_LOCAL_PATH)
            : s3Catalog(
                config.READINGS_S3_BUCKET,
                config.READINGS_S3_KEY,
                new S3Client({ region: config.READINGS_REGION })
              ),
          { sample: config.READINGS_SAMPLE === 'true' }
        );
      }
      return state.dailyReadings;
    },
    get quotas() {
      if (!state.doorknobQuotas) {
        const settings = environment();
        const config = parseQuotaConfig(settings);
        const table = config.tableName;
        const backend = table
          ? new DynamoQuotaBackend(
              table,
              DynamoDBDocumentClient.from(
                new DynamoDBClient({
                  region: settings.DYNAMODB_REGION ?? settings.AWS_REGION,
                  maxAttempts: 2,
                  requestHandler: {
                    connectionTimeout: 2000,
                    requestTimeout: 5000
                  }
                })
              )
            )
          : (settings.SHARE_PERSISTENCE ?? 'memory') === 'memory' &&
              (settings.NODE_ENV !== 'production' ||
                settings.QUOTA_LOCAL_ONLY === 'true')
            ? new MemoryQuotaBackend()
            : undefined;
        if (!backend) throw new Error('quota backend required');
        state.doorknobQuotas = new QuotaService(
          backend,
          () => Date.now(),
          config.policy
        );
      }
      return state.doorknobQuotas;
    }
  };
}
export const serverServices = createServerServices(
  undefined,
  globalThis as ServiceState
);
