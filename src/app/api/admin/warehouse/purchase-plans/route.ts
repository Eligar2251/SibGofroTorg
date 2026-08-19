import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi, hasPermission } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";
import {
  addPurchaseContribution,
  createPurchasePlan,
  deletePurchasePlan,
  getPurchasePlans,
  refreshPurchasePlanOzon,
  spendPurchasePlan,
} from "@/lib/purchase-plans";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ plans: await getPurchasePlans() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить закупки" },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json().catch(() => ({}));
    const plan = await createPurchasePlan(body);
    await logAdminAction(
      auth.displayName,
      auth.role,
      "create",
      "purchase-plan",
      plan.id,
      `Создан план закупки «${plan.productName}»`,
      {
        targetAmount: plan.targetAmount,
        contributionAmount: plan.contributionAmount,
        ozonUrl: plan.ozonUrl,
        ozonPrice: plan.ozonPrice,
      }
    );
    return NextResponse.json({ plan });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось создать план" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === "refresh-ozon") {
      const result = await refreshPurchasePlanOzon(body.id);
      await logAdminAction(
        auth.displayName,
        auth.role,
        "update",
        "purchase-plan",
        result.plan.id,
        result.warning
          ? `Не удалось обновить цену Ozon для «${result.plan.productName}»`
          : `Цена Ozon для «${result.plan.productName}» обновлена: ${result.plan.ozonPrice} ₽`,
        {
          ozonPrice: result.plan.ozonPrice,
          warning: result.warning,
        }
      );
      return NextResponse.json(result);
    }
    if (body.action === "contribute") {
      const plan = await addPurchaseContribution(body);
      await logAdminAction(
        auth.displayName,
        auth.role,
        "update",
        "purchase-plan",
        plan.id,
        `Отложено ${Number(body.amount) || 0} ₽ на «${plan.productName}»`,
        { amount: Number(body.amount) || 0, savedAmount: plan.savedAmount }
      );
      return NextResponse.json({ plan });
    }
    if (body.action === "update") {
      const plan = await updatePurchasePlan(body);
      await logAdminAction(
        auth.displayName,
        auth.role,
        "update",
        "purchase-plan",
        plan.id,
        `Изменён план закупки «${plan.productName}»`,
        { targetAmount: plan.targetAmount, images: plan.images.length }
      );
      return NextResponse.json({ plan });
    }
    if (body.action === "spend") {
      const plan = await spendPurchasePlan(body);
      await logAdminAction(
        auth.displayName,
        auth.role,
        "post",
        "purchase-plan",
        plan.id,
        `Списано ${plan.spentAmount} ₽ на закупку «${plan.productName}»`,
        { account: plan.account, paymentId: plan.spentPaymentId }
      );
      return NextResponse.json({ plan });
    }
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось изменить план" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "delete")) {
    return NextResponse.json({ error: "Нет прав на удаление" }, { status: 403 });
  }
  try {
    const id = new URL(request.url).searchParams.get("id");
    await deletePurchasePlan(id);
    await logAdminAction(
      auth.displayName,
      auth.role,
      "delete",
      "purchase-plan",
      String(id || ""),
      "Удалён план закупки"
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось удалить план" },
      { status: 400 }
    );
  }
}
