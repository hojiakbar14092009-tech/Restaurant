// Menu content. Edit freely: add/remove items, change prices, or point `image` at your own photos
// (800x600 WebP in public/assets/menu). Names are generic on purpose: no third-party brands.

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number; // in CURRENCY units
  image: string; // file name inside public/assets/menu
  tag?: 'Signature' | 'Spicy' | 'New';
}
export interface MenuCategory {
  id: string;
  title: string;
  items: MenuItem[];
}

export const CURRENCY = "so'm";
export const formatPrice = (value: number) => `${value.toLocaleString('en-US').replace(/,/g, ' ')} ${CURRENCY}`;

const item = (id: string, name: string, description: string, price: number, tag?: MenuItem['tag']): MenuItem => ({
  id, name, description, price, image: `${id}.webp`, tag,
});

export const MENU: MenuCategory[] = [
  {
    id: 'buckets',
    title: 'Chicken buckets',
    items: [
      item('classic-bucket', 'Classic Bucket', 'Eight pieces of golden fried chicken in our eleven-spice crust.', 119000, 'Signature'),
      item('crispy-drumsticks', 'Crispy Drumsticks', 'Six juicy drumsticks, double-breaded and fried to order.', 79000),
      item('hot-wings', 'Hot Wings', 'Eight fiery wings with a cooling blue-cheese dip.', 62000, 'Spicy'),
      item('golden-strips', 'Golden Strips', 'Five tender fillet strips with fries and honey-mustard sauce.', 58000),
      item('popcorn-bites', 'Popcorn Bites', 'Bite-size chicken pieces with ketchup. Made for sharing.', 42000),
    ],
  },
  {
    id: 'burgers',
    title: 'Burgers & Twisters',
    items: [
      item('crispy-chicken-burger', 'Crispy Chicken Burger', 'Crunchy fillet, pesto mayo, lettuce and tomato in a brioche bun.', 49000, 'Signature'),
      item('double-cheeseburger', 'Double Cheeseburger', 'Two beef patties, melted cheddar, pickles and house sauce.', 56000),
      item('classic-twister', 'Classic Twister', 'Chicken strips, crisp salad and garlic sauce in a toasted wrap.', 44000),
      item('spicy-twister', 'Spicy Twister', 'Hot-glazed chicken, red cabbage and chilli mayo in a tortilla.', 46000, 'Spicy'),
    ],
  },
  {
    id: 'sides',
    title: 'Sides',
    items: [
      item('fries', 'French Fries', 'Skin-on fries with sea salt.', 19000),
      item('coleslaw', 'Coleslaw', 'Red cabbage, herbs and sunflower seeds in a light dressing.', 16000, 'New'),
      item('corn', 'Corn on the Cob', 'Sweet corn, grilled and brushed with butter.', 15000),
      item('onion-rings', 'Onion Rings', 'Beer-battered rings with barbecue dip.', 21000),
      item('mashed-potatoes', 'Mashed Potatoes', 'Creamy mash with a touch of butter.', 17000),
    ],
  },
  {
    id: 'desserts',
    title: 'Desserts',
    items: [
      item('sundae', 'Ice-cream Sundae', 'Vanilla ice cream, chocolate sauce, whipped cream and a cherry.', 26000),
      item('brownie', 'Chocolate Brownie', 'Dense, fudgy and served slightly warm.', 24000),
      item('apple-pie', 'Apple Pie', 'Warm apple pie with a scoop of vanilla ice cream.', 27000, 'Signature'),
      item('donut', 'Chocolate Doughnut', 'Soft doughnut with a dark chocolate glaze.', 14000),
    ],
  },
  {
    id: 'drinks',
    title: 'Drinks',
    items: [
      item('cola', 'Cola', 'Ice-cold, with a slice of lemon. 0.4 l', 12000),
      item('orange-juice', 'Fresh Orange Juice', 'Squeezed to order. 0.3 l', 22000),
      item('lemonade', 'House Lemonade', 'Lemon, mint and sparkling water. 0.4 l', 18000),
      item('cappuccino', 'Cappuccino', 'Double espresso with silky milk foam.', 20000),
      item('black-tea', 'Black Tea with Lemon', 'A pot of Assam tea.', 12000),
      item('milkshake', 'Chocolate Milkshake', 'Thick shake with chocolate sauce and cream.', 28000, 'New'),
    ],
  },
];

export const findItem = (id: string) => MENU.flatMap((c) => c.items).find((i) => i.id === id);
