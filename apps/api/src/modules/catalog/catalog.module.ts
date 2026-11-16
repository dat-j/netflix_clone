import { Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller.js";
import { BrowseService } from "./browse.service.js";
import { PersonalService } from "./personal.service.js";
import { TitleCardsService } from "./title-cards.service.js";

@Module({
  controllers: [CatalogController],
  providers: [TitleCardsService, BrowseService, PersonalService],
  exports: [TitleCardsService, BrowseService],
})
export class CatalogModule {}
