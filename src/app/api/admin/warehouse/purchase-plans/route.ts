import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi, hasPermission } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";
import {
  addPurchaseContribution,
  addPurchasePayment,
  attachPaymentToPurchase,
  convertContributionToPayment,
  createPurchasePlan,
  deleteContribution,
  deletePurchasePayment,
  deletePurchasePlan,
  getPurchasePlans,
  refreshPurchasePlanOzon,
  setPurchasePlanStatus,
  updatePurchasePayment,
  updatePurchasePlan,
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
    if (body.action === "add-payment") {
      const plan = await addPurchasePayment(body);
      await logAdminAction(
        auth.displayName,
        auth.role,
        "create",
        "purchase-plan",
        plan.id,
        `Платёж ${Number(body.amount) || 0} ₽ по закупке «${plan.productName}»`,
        { amount: Number(body.amount) || 0, paidAmount: plan.paidAmount }
      );
      return NextResponse.json({ plan });
    }
    if (body.action === "update-payment") {
      const plan = await updatePurchasePayment(body);
      await logAdminAction(
        auth.displayName,
        auth.role,
        "update",
        "purchase-plan",
        plan.id,
        `Изменён платёж по закупке «${plan.productName}»`,
        { paymentId: String(body.paymentId || ""), paidAmount: plan.paidAmount }
      );
      return NextResponse.json({ plan });
    }
    if (body.action === "delete-payment") {
      if (!hasPermission(auth, "delete")) {
        return NextResponse.json({ error: "Нет прав на удаление" }, { status: 403 });
      }
      const plan = await deletePurchasePayment(body.paymentId);
      await logAdminAction(
        auth.displayName,
        auth.role,
        "delete",
        "purchase-plan",
        plan?.id || "",
        `Удалён платёж по закупке${plan ? ` «${plan.productName}»` : ""}`,
        { paymentId: String(body.paymentId || "") }
      );
      return NextResponse.json({ plan });
    }
    if (body.action === "attach-payment") {
      await attachPaymentToPurchase(body);
      await logAdminAction(
        auth.displayName,
        auth.role,
        "update",
        "purchase-plan",
        String(body.planId || ""),
        body.planId
          ? "Платёж отнесён к закупке"
          : "Платёж отвязан от закупки",
        { paymentId: String(body.paymentId || "") }
      );
      return NextResponse.json({ plans: await getPurchasePlans() });
    }
    if (body.action === "convert-contribution") {
      const plan = await convertContributionToPayment(body);
      await logAdminAction(
        auth.displayName,
        auth.role,
        "update",
        "purchase-plan",
        plan.id,
        `Отложенное проведено платежом по закупке «${plan.productName}»`
      );
      return NextResponse.json({ plan });
    }
    if (body.action === "delete-contribution") {
      const plan = await deleteContribution(body);
      await logAdminAction(
        auth.displayName,
        auth.role,
        "update",
        "purchase-plan",
        plan.id,
        `Удалено отложенное по закупке «${plan.productName}»`
      );
      return NextResponse.json({ plan });
    }
    if (body.action === "status") {
      const plan = await setPurchasePlanStatus(body);
      await logAdminAction(
        auth.displayName,
        auth.role,
        "update",
        "purchase-plan",
        plan.id,
        plan.status === "completed"
          ? `Закупка «${plan.productName}» закрыта`
          : `Закупка «${plan.productName}» снова открыта`
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
