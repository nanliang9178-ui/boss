import { Body, Controller, Get, Put } from '@nestjs/common';
import { Roles, TenantId } from '../../common/decorators';
import { StoreService } from './store.service';
import { UpdateBrandDto, UpdateStoreDto } from './dto';

@Controller('admin/store')
export class StoreController {
  constructor(private readonly store: StoreService) {}

  @Get()
  async overview(@TenantId() tenantId: string) {
    const [store, brand] = await Promise.all([this.store.getStore(tenantId), this.store.getBrand(tenantId)]);
    return { store, brand };
  }

  @Put()
  @Roles('MANAGER')
  update(@TenantId() tenantId: string, @Body() dto: UpdateStoreDto) {
    return this.store.updateStore(tenantId, dto);
  }

  /**
   * 品牌白标只允许平台运营端修改（PUT /platform/tenants/:id/brand），
   * 商户端不再提供该入口，避免各商户改乱视觉规范。
   */
}
