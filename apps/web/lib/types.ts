// Shapes returned by /v1/storefront/* (see apps/api and docs/openapi.json).

export type Page<T> = { items: T[]; nextCursor: string | null };

export type Seo = { title?: string; description?: string; [k: string]: unknown } | null;

export type StoreSettings = {
  theme?: Record<string, string>;
  logoUrl?: string;
  faviconUrl?: string;
  announcement?: string;
  contact?: { email?: string; phone?: string };
  social?: Partial<Record<'instagram' | 'facebook' | 'youtube' | 'x' | 'whatsapp' | 'pinterest', string>>;
  seo?: { titleTemplate?: string; defaultDescription?: string };
};

export type Store = {
  id: string;
  slug: string;
  name: string;
  currency: string;
  locale: string;
  timezone: string;
  settings: StoreSettings;
  brand: { slug: string; name: string };
};

export type Category = { id: string; parentId: string | null; slug: string; name: string; description: string | null; seo: Seo };
export type Collection = { id: string; slug: string; title: string; description: string | null; seo: Seo };

export type ProductSummary = {
  id: string;
  slug: string;
  title: string;
  createdAt: string;
  minPricePaise: number | null;
  maxMrpPaise: number | null;
  imageUrl: string | null;
};

export type Media = { url: string; kind: string; altText: string | null; width: number | null; height: number | null; variantId: string | null };

export type Variant = {
  id: string;
  skuCode: string;
  title: string;
  options: Record<string, string>;
  optionLabels: Record<string, string>;
  mrpPaise: number;
  pricePaise: number;
  inStock: boolean;
};

export type SizeChart = { name: string; chart: unknown; notes: string | null };

export type Product = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  specifications: unknown;
  attributes: { code: string; label: string; value: unknown }[];
  seo: Seo;
  sizeChart: SizeChart | null;
  media: Media[];
  variants: Variant[];
};

export type Link = { label: string; href: string; children?: Link[] };
export type Image = { url: string; alt?: string };

export type HomepageSection = {
  layout: 'hero' | 'product_grid' | 'collection_grid' | 'category_grid' | 'rich_text' | 'image_with_text';
  heading?: string;
  body?: string;
  image?: Image;
  collectionSlug?: string;
  categorySlugs?: string[];
  productLimit?: number;
  link?: Link;
};
export type Banner = { image: Image; mobileImage?: Image; link?: Link; headline?: string };
export type Block<T> = { key: string; title: string | null; data: T; position: number };

export type ContentPage = { kind: 'page' | 'policy' | 'faq'; slug: string; title: string; body: string; seo: Seo; updatedAt: string };

export type QuoteIssue = { code: string; message: string; variantId?: string };
export type QuoteLine = {
  itemId: string;
  variantId: string;
  productId: string;
  productSlug: string;
  productTitle: string;
  variantTitle: string;
  skuCode: string;
  options: Record<string, string>;
  imageUrl: string | null;
  quantity: number;
  mrpPaise: number | null;
  unitPricePaise: number | null;
  discountPaise: number;
  lineTotalPaise: number;
  sellable: boolean;
  availableQuantity: number | null;
};
export type Quote = {
  lines: QuoteLine[];
  issues: QuoteIssue[];
  coupon: { code: string; status: string; message?: string } | null;
  appliedPromotions: { name: string; couponCode?: string | null; discountPaise: number; shippingDiscountPaise: number }[];
  shipping: { pincode: string; serviceable: boolean; zoneName?: string; codAvailable: boolean; estimatedDays?: [number, number] } | null;
  subtotalPaise: number;
  itemDiscountPaise: number;
  shippingPaise: number;
  shippingDiscountPaise: number;
  discountPaise: number;
  codFeePaise: number;
  taxPaise: number;
  totalPaise: number;
};
export type CartView = { cart: { id: string; couponCode: string | null }; quote: Quote };

export type Customer = { id: string; phone: string; name: string | null; email: string | null; hasPassword: boolean; createdAt: string };

export type Address = {
  id: string;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
};

export type OrderSummary = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  totalPaise: number;
  placedAt: string | null;
  createdAt: string;
};

export type Order = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  paymentMethod: 'online' | 'cod';
  currency: string;
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  taxPaise: number;
  totalPaise: number;
  refundedPaise: number;
  shippingAddress: Partial<Address>;
  appliedPromotions: { name: string; couponCode?: string | null; discountPaise: number; shippingDiscountPaise: number }[];
  placedAt: string | null;
  items: {
    id: string;
    productTitle: string;
    variantTitle: string;
    skuCode: string;
    options: Record<string, string>;
    imageUrl: string | null;
    quantity: number;
    mrpPaise: number | null;
    unitPricePaise: number;
    discountPaise: number;
    taxPaise: number;
    lineTotalPaise: number;
  }[];
  timeline: { machine: string; toState: string; note: string | null; createdAt: string }[];
  shipments: { id: string; status: string; courier: string | null; trackingNumber: string | null; trackingUrl: string | null }[];
  returns: { id: string; type: string; status: string; createdAt: string }[];
  /** What the customer may do right now, decided by the API. Never recompute these rules in the browser. */
  actions: { canCancel: boolean; canReturn: boolean; returnWindowEndsAt: string | null };
};

export type ExchangeOptions = { items: { orderItemId: string; variants: { id: string; title: string; options: Record<string, string> }[] }[] };

export type Serviceability = {
  pincode: string;
  serviceable: boolean;
  chargePaise?: number;
  freeAbovePaise?: number | null;
  codAvailable?: boolean;
  estimatedDays?: [number, number] | null;
};

export type PaymentStart = {
  payment: { transactionId: string; provider: string; amountPaise: number; currency: string; client: Record<string, unknown> };
};

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal',
] as const;
