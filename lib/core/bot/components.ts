import type { Component } from "../../internal/types/config.ts";
import { join } from "node:path";
import { underline, yellow } from "@std/fmt/colors";
import loader from "../../internal/loader.ts";
import type {
  MessageComponentInteraction,
  ModalSubmitInteraction,
} from "../../internal/types/interaction.ts";
import { ComponentType } from "discord-api-types/v10";
import { walk } from "@std/fs/walk";

/**
 * Fetches the components from the components directory
 *
 * @returns A function that runs a component
 */
export default async function setupComponents(): Promise<
  (
    interaction: MessageComponentInteraction | ModalSubmitInteraction,
  ) => Promise<void>
> {
  const generatingLoader = loader("Generating components");
  let generatedN = 0;
  const generatedStr: string[][] = [[underline("\nComponent")]];

  function addComponent(
    name: string,
    category: string,
    totalComponents: number,
  ) {
    generatedN++;
    generatedStr.push([
      totalComponents === 1
        ? "-"
        : generatedN === 1
        ? "┌"
        : totalComponents === generatedN
        ? "└"
        : "├",
      name + ` (${category})`,
    ]);
  }

  try {
    const components = await fetchComponents();

    components.forEach((component) => {
      addComponent(component.name, component.category, components.length);
    });

    await generatingLoader.resolve();

    console.log(generatedStr.map((row) => row.join(" ")).join("\n"));

    return async function runComponent(
      interaction: MessageComponentInteraction | ModalSubmitInteraction,
    ) {
      const category = getCategory();

      function getCategory() {
        switch (
          (interaction.data as { component_type: number }).component_type
        ) {
          case ComponentType.Button:
            return "buttons";
          case ComponentType.ChannelSelect:
          case ComponentType.RoleSelect:
          case ComponentType.UserSelect:
          case ComponentType.StringSelect:
          case ComponentType.MentionableSelect:
            return "selects";
          default:
            return "modals";
        }
      }

      const component = components.find(
        (c) => c.name === interaction.data.custom_id && c.category === category,
      );

      if (!component) {
        console.warn(
          ` ${yellow("!")} Component "${interaction.data.custom_id}" not found`,
        );
        return;
      }

      const componentLoader = loader(`Running component "${component.name}"`);

      try {
        await Promise.resolve(component.default(interaction));
        await componentLoader.resolve();
      } catch (error) {
        await componentLoader.error();
        console.error(" └", error);
      }
    };
  } catch (e) {
    await generatingLoader.error();
    throw e;
  }
}

const validComponentCategories = ["buttons", "modals", "selects"];

async function fetchComponents() {
  try {
    Deno.readDirSync("./src/components");
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      console.warn(` ${yellow("!")} src/components directory not found`);
    }
    return [];
  }

  const presentCategories = [];

  for (const category of validComponentCategories) {
    try {
      Deno.readDirSync("./src/components/" + category);
      presentCategories.push(category);
    } catch {
      // pass
    }
  }

  const files = await Array.fromAsync(
    walk("./src/components", {
      exts: [".ts"],
      includeDirs: false,
    }),
  );
  const componentData: Component[] = [];

  for (const file of files) {
    const componentModule = (await import(
      join("file://", Deno.cwd(), file.path)
    )) as {
      config?: Component;
      default: (
        interaction: MessageComponentInteraction | ModalSubmitInteraction,
      ) => unknown;
    };

    const category = file.path.split(/[\\\/]/)[2];

    if (!validComponentCategories.includes(category)) {
      console.warn(
        ` ${yellow("!")} Category for "${
          file.name.split(".")[0]
        }" could not be determined, skipping`,
      );
      continue;
    }

    const component: Component = {
      name: file.name.split(".")[0],
      category: category as "buttons" | "modals" | "selects",
      default: componentModule.default,
    };

    if (
      componentData.find(
        (c) => c.name === component.name && c.category === category,
      )
    ) {
      console.warn(
        ` ${yellow("!")} ${
          component.category.slice(0, 1).toUpperCase() +
          component.category.split("s")[0].slice(1)
        } component "${component.name}" already exists, skipping the duplicate`,
      );
      continue;
    }

    componentData.push(component);
  }

  return componentData;
}