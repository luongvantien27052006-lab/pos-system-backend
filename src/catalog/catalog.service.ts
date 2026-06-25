import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

interface CategoryRow {
  id: number;
  name: string;
}
interface ProductRow {
  id: number;
  category_id: number;
  name: string;
  short_name: string | null;
  price: string;
  image_url: string | null;
  is_available: boolean;
}
interface OptionRow {
  product_id: number;
  id: number;
  name: string;
  price: string;
  group_name: string | null;
}

@Injectable()
export class CatalogService {
  constructor(private readonly db: DatabaseService) {}

  /** Menu đầy đủ: danh mục -> món -> topping khả dụng. Phục vụ cả khách & quầy. */
  async getMenu() {
    const categories = await this.db.query<CategoryRow>(
      `SELECT id, name FROM categories WHERE is_active = TRUE ORDER BY display_order, name`,
    );
    const products = await this.db.query<ProductRow>(
      `SELECT id, category_id, name, short_name, price, image_url, is_available
         FROM products WHERE is_active = TRUE ORDER BY display_order, name`,
    );
    const options = await this.db.query<OptionRow>(
      `SELECT po.product_id, o.id, o.name, o.price, o.group_name
         FROM product_options po JOIN options o ON o.id = po.option_id
        WHERE o.is_active = TRUE
        ORDER BY o.group_name NULLS FIRST, o.name`,
    );

    const optionsByProduct = new Map<number, unknown[]>();
    for (const o of options) {
      const list = optionsByProduct.get(o.product_id) ?? [];
      list.push({
        id: o.id,
        name: o.name,
        price: Number(o.price),
        groupName: o.group_name,
      });
      optionsByProduct.set(o.product_id, list);
    }

    const productsByCategory = new Map<number, unknown[]>();
    for (const p of products) {
      const list = productsByCategory.get(p.category_id) ?? [];
      list.push({
        id: p.id,
        name: p.name,
        shortName: p.short_name,
        price: Number(p.price),
        imageUrl: p.image_url,
        isAvailable: p.is_available,
        options: optionsByProduct.get(p.id) ?? [],
      });
      productsByCategory.set(p.category_id, list);
    }

    return {
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        products: productsByCategory.get(c.id) ?? [],
      })),
    };
  }

  /** Danh sách bàn (cho POS gán đơn & sơ đồ bàn). */
  getTables() {
    return this.db.query(
      `SELECT id,
              table_number AS "tableNumber",
              display_name AS "displayName",
              status
         FROM tables WHERE is_active = TRUE ORDER BY table_number`,
    );
  }
}