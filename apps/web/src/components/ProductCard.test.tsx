import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { productFixture } from "../../tests/fixtures";
import { ProductCard } from "./ProductCard";

describe("ProductCard", () => {
  test("altera a quantidade por botões explícitos de menos e mais", async () => {
    const user = userEvent.setup();
    const onQuantityChange = jest.fn();

    render(
      <ProductCard
        product={productFixture}
        quantity="2"
        quantityError={null}
        disabled={false}
        onAdd={jest.fn()}
        onQuantityChange={onQuantityChange}
      />
    );

    const quantity = screen.getByLabelText("Quantidade");
    expect(quantity).toHaveAttribute("type", "text");

    await user.click(
      screen.getByRole("button", {
        name: `Diminuir quantidade de ${productFixture.name}`
      })
    );
    await user.click(
      screen.getByRole("button", {
        name: `Aumentar quantidade de ${productFixture.name}`
      })
    );

    expect(onQuantityChange).toHaveBeenNthCalledWith(
      1,
      productFixture.id,
      "1"
    );
    expect(onQuantityChange).toHaveBeenNthCalledWith(
      2,
      productFixture.id,
      "3"
    );
  });
});
