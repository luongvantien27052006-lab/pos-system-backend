import { Controller, Get } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** GET /api/menu */
  @Get('menu')
  getMenu() {
    return this.catalog.getMenu();
  }

  /** GET /api/tables */
  @Get('tables')
  getTables() {
    return this.catalog.getTables();
  }
}