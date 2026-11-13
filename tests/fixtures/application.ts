import { createHttpApplication } from '../../src/server/app';
import { createServerServices } from '../../src/server/services';
import { InMemoryShareRepository } from '../../src/shares/server/storage/memory-repository';
import { ReadingCache } from '../../src/readings/server/cache';
import { localCatalog } from '../../src/readings/server/sources';
import { createReadingService } from '../../src/readings/server/service';
import { QuotaService } from '../../src/server/abuse/quotas';
import { MemoryQuotaBackend } from '../../src/server/abuse/memory-quotas';

// Legacy HTTP scenarios can still vary an environment between requests without mutating production singletons.
// New scenarios should bind createHttpApplication(createServerServices(settings, overrides)) once per test.
export const shareRepository = new InMemoryShareRepository();
export const readings = createReadingService(
  new ReadingCache(localCatalog('infra/terraform/readings.example.yaml'), {
    sample: true
  })
);
const quotas = new QuotaService(new MemoryQuotaBackend(), () => Date.now());
const services = () =>
  createServerServices(process.env, {
    shares: shareRepository,
    readings,
    quotas
  });
export const dispatch = (request: Request) =>
  createHttpApplication(services()).dispatch(request);
export const getOpenApiDocument = () =>
  createHttpApplication(services).getOpenApiDocument();
