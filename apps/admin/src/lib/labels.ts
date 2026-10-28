export const ENTITY_LABELS: Record<string, string> = {
  Branch: 'Chi nhánh', User: 'Người dùng', Role: 'Vai trò', Setting: 'Thiết lập',
};
export const ACTION_LABELS: Record<string, string> = {
  create: 'Thêm mới', update: 'Cập nhật', delete: 'Xóa', cancel: 'Hủy', complete: 'Hoàn thành',
  login: 'Đăng nhập', logout: 'Đăng xuất', settings: 'Thiết lập', import: 'Import',
};

/** Stock ledger document types → Vietnamese label. */
export const DOC_TYPE_LABELS: Record<string, string> = {
  opening: 'Tồn kho ban đầu', receipt: 'Nhập hàng', receipt_cancel: 'Hủy nhập hàng', purchaseReturn: 'Trả hàng nhập', purchaseReturn_cancel: 'Hủy trả hàng nhập',
  invoice: 'Bán hàng', invoice_cancel: 'Hủy hóa đơn', return: 'Khách trả hàng', return_cancel: 'Hủy trả hàng',
  stockTake: 'Kiểm kho', stockTake_cancel: 'Hủy kiểm kho', writeOff: 'Xuất hủy', writeOff_cancel: 'Hủy xuất hủy',
  internalUse: 'Xuất dùng nội bộ', internalUse_cancel: 'Hủy xuất dùng nội bộ', transferOut: 'Chuyển hàng đi', transferOut_cancel: 'Hủy chuyển hàng',
  transferIn: 'Nhận hàng chuyển',
};

export const PRODUCT_TYPE_LABELS: Record<string, string> = { goods: 'Hàng hóa thường', service: 'Dịch vụ', combo: 'Combo - đóng gói' };

Object.assign(ENTITY_LABELS, {
  Product: 'Hàng hóa', ProductGroup: 'Nhóm hàng', Brand: 'Thương hiệu', Location: 'Vị trí', PriceBook: 'Bảng giá',
  StockTake: 'Kiểm kho', StockIssue: 'Xuất kho', Transfer: 'Chuyển hàng',
  Supplier: 'Nhà cung cấp', SupplierGroup: 'Nhóm NCC', PurchaseOrder: 'Đặt hàng nhập', PurchaseReceipt: 'Nhập hàng', PurchaseReturn: 'Trả hàng nhập',
  IncomingInvoice: 'Hóa đơn đầu vào', ServicePurchase: 'Mua dịch vụ', CashVoucher: 'Sổ quỹ',
  Invoice: 'Hóa đơn', SaleReturn: 'Trả hàng', CustomerOrder: 'Đặt hàng', Shift: 'Ca làm việc', CashFund: 'Quỹ tiền', DeliveryPartner: 'Đối tác giao hàng', Delivery: 'Vận đơn', CodReconciliation: 'Đối soát COD', CashCategory: 'Loại thu chi',
  Customer: 'Khách hàng', CustomerGroup: 'Nhóm khách hàng', Promotion: 'Khuyến mại', VoucherCampaign: 'Voucher', MessageLog: 'Tin nhắn',
});
