import { Global, Module } from "@nestjs/common";
import { StorageService } from "./storage.service.js";
import { CdnSigner, cdnProvider, createCdnSigner } from "./cdn-signer.js";
import { DevCdnController } from "./dev-cdn.controller.js";
import { ImagePipelineService } from "./image-pipeline.service.js";

@Global()
@Module({
  controllers: cdnProvider() === "local" ? [DevCdnController] : [],
  providers: [
    StorageService,
    ImagePipelineService,
    { provide: CdnSigner, useFactory: () => createCdnSigner() },
  ],
  exports: [StorageService, ImagePipelineService, CdnSigner],
})
export class StorageModule {}
