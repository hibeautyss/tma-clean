#!/usr/bin/env node
import process from "node:process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { URL } from "node:url";
import { existsSync } from "node:fs";
import chalk from "chalk";
import { program } from "commander";
import { spawn } from "node:child_process";
import ora from "ora";
import { createPrompt, useState, useMemo, useKeypress, isSpaceKey, isEnterKey, isUpKey, isDownKey, Separator, makeTheme, useEffect } from "@inquirer/core";
import ansiEscapes from "ansi-escapes";
import figures from "figures";
function formatError(e) {
  return e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
}
function spawnWithSpinner({
  command,
  message,
  messageFail,
  messageSuccess,
  theme: {
    style,
    spinner: themeSpinner
  }
}) {
  const spinner = ora({
    text: style.message(message, "loading"),
    hideCursor: false,
    spinner: themeSpinner
  }).start();
  const success = messageSuccess && style.message(messageSuccess, "done");
  if (typeof command === "function") {
    return command().then(() => {
      spinner.succeed(success);
    }).catch((e) => {
      const errString = formatError(e);
      spinner.fail(
        style.error(
          messageFail ? typeof messageFail === "string" ? messageFail : messageFail(errString) : errString
        )
      );
      throw e;
    });
  }
  return new Promise((res, rej) => {
    const proc = spawn(command, { shell: true });
    let errBuf = Buffer.from([]);
    proc.stderr.on("data", (buf) => {
      errBuf = Buffer.concat([errBuf, buf]);
      spinner.suffixText = chalk.bgGray.italic(buf.toString());
    });
    proc.on("exit", (code) => {
      spinner.suffixText = "";
      if (!code) {
        spinner.succeed(success);
        res();
        return;
      }
      const errString = errBuf.length ? errBuf.toString() : `Error code: ${code}`;
      const errorMessage = style.error(
        messageFail ? typeof messageFail === "string" ? messageFail : messageFail(errString) : errString
      );
      spinner.fail(errorMessage);
      rej(new Error(errorMessage));
    });
  });
}
async function cloneTemplate(rootDir, {
  clone: { https, ssh },
  link
}, theme) {
  const messageSuccess = `Cloned template: ${chalk.blue(link)}`;
  try {
    await spawnWithSpinner({
      command: `git clone "${https}" "${rootDir}"`,
      message: `Cloning the template from GitHub (HTTPS): ${chalk.bold.blue(https)}`,
      messageFail: (error) => `Failed to load the template using HTTPS. ${error}`,
      messageSuccess,
      theme
    });
    return;
  } catch {
  }
  await spawnWithSpinner({
    command: `git clone "${ssh}" "${rootDir}"`,
    message: `Cloning the template from GitHub (SSH): ${chalk.bold.blue(ssh)}`,
    messageFail: (error) => `Failed to load the template using SSH. ${error}`,
    messageSuccess,
    theme
  });
}
function isGitInstalled() {
  return new Promise((res) => {
    spawn("git --version", { shell: true }).on("exit", (code) => {
      res(!code);
    });
  });
}
function lines(...arr) {
  return arr.flat(1).filter((v) => typeof v === "string").join("\n");
}
function jsRepo(name2) {
  return {
    repository: name2,
    deprecationReason: "JavaScript templates are not supported and most likely to be outdated. To use more actual template, consider using TypeScript alternatives."
  };
}
function jQueryRepo(name2) {
  return {
    repository: name2,
    deprecationReason: "jQuery template is not supported and most likely to be outdated. To use more actual template, consider using other technologies."
  };
}
function pureRepo(name2) {
  return {
    repository: name2,
    deprecationReason: "Pure JavaScript and TypeScript templates are not supported and most likely to be outdated. To use more actual template, consider using other technologies."
  };
}
const templates = {
  js: {
    tmajs: {
      react: jsRepo("reactjs-js-template"),
      solid: jsRepo("solidjs-js-template"),
      next: jsRepo("nextjs-js-template"),
      jquery: jQueryRepo("js-template"),
      none: pureRepo("vanillajs-template")
    },
    tsdk: {
      react: jsRepo("reactjs-js-tsdk-template"),
      solid: jsRepo("solidjs-js-tsdk-template"),
      next: jsRepo("nextjs-js-tsdk-template"),
      jquery: jQueryRepo("js-tsdk-template"),
      none: pureRepo("vanillajs-tsdk-template")
    }
  },
  ts: {
    tmajs: {
      react: "reactjs-template",
      solid: "solidjs-template",
      next: "nextjs-template",
      jquery: jQueryRepo("typescript-template"),
      vue: "vuejs-template"
    },
    tsdk: {
      react: "reactjs-tsdk-template",
      solid: "solidjs-tsdk-template",
      next: "nextjs-tsdk-template",
      jquery: jQueryRepo("typescript-tsdk-template")
    }
  }
};
function findTemplate(language, sdk, framework) {
  var _a, _b;
  const repo = (_b = (_a = templates[language]) == null ? void 0 : _a[sdk]) == null ? void 0 : _b[framework];
  if (!repo) {
    return;
  }
  const repoName = typeof repo === "string" ? repo : repo.repository;
  const deprecationReason = typeof repo === "string" ? void 0 : repo.deprecationReason;
  return {
    sdk,
    language,
    framework,
    deprecationReason,
    repository: {
      clone: {
        https: `https://github.com/Telegram-Mini-Apps/${repoName}.git`,
        ssh: `git@github.com:Telegram-Mini-Apps/${repoName}.git`
      },
      link: `github.com/Telegram-Mini-Apps/${repoName}`
    }
  };
}
function spaces(...arr) {
  return arr.flat(1).filter((v) => typeof v === "string").join(" ");
}
const sections = [
  {
    title: "Language",
    name: "language",
    choices: [
      { title: "TypeScript", value: "ts", defaultChecked: true },
      { title: "JavaScript", value: "js" }
    ]
  },
  {
    title: "SDK",
    name: "sdk",
    choices: [
      { title: "@tma.js", value: "tmajs", defaultChecked: true },
      { title: "Telegram SDK", value: "tsdk" }
    ]
  },
  {
    title: "Framework",
    name: "framework",
    choices: [
      { title: "React.js", value: "react", defaultChecked: true },
      { title: "Solid.js", value: "solid" },
      { title: "Next.js", value: "next" },
      { title: "Vue.js", value: "vue" },
      { title: "jQuery", value: "jquery" },
      { title: "None", value: "none" }
    ]
  }
];
function findTitleByNameAndValue(name2, value) {
  var _a, _b;
  return (_b = (_a = sections.find((s) => s.name === name2)) == null ? void 0 : _a.choices.find((c) => c.value === value)) == null ? void 0 : _b.title;
}
const CORNER_TOP_LEFT = figures.lineDownBoldRightBold;
const CORNER_TOP_RIGHT = figures.lineDownBoldLeftBold;
const CORNER_BOTTOM_LEFT = figures.lineUpBoldRightBold;
const CORNER_BOTTOM_RIGHT = figures.lineUpBoldLeftBold;
const LINE_HOR_T_DOWN = figures.lineDownBoldLeftBoldRightBold;
const LINE_HOR_T_UP = figures.lineUpBoldLeftBoldRightBold;
const LINE_HOR = figures.lineBold;
const LINE_VER = figures.lineVerticalBold;
const PADDING_HOR_LEFT = 1;
const PADDING_HOR_RIGHT = 3;
const promptTemplate = createPrompt(
  ({
    theme: { style, prefix }
  }, done) => {
    const [x, setX] = useState(0);
    const [y, setY] = useState(0);
    const [selected, setSelected] = useState(
      useMemo(() => {
        return sections.reduce((acc, section) => {
          section.choices.forEach((item) => {
            if (item.defaultChecked) {
              acc[section.name] = item.value;
            }
          });
          return acc;
        }, { framework: "react", sdk: "tmajs", language: "ts" });
      }, [])
    );
    const [completed, setCompleted] = useState(false);
    const template = findTemplate(selected.language, selected.sdk, selected.framework);
    const maxY = useMemo(() => sections[x].choices.length - 1, [x]);
    const [lengths, rows] = useMemo(() => {
      const lengths2 = new Array(sections.length).fill(0);
      const rows2 = [[]];
      let maxChoicesCount = 0;
      sections.forEach((section, sIdx) => {
        const sectionTitle = `  ${section.title}`;
        lengths2[sIdx] = Math.max(lengths2[sIdx], sectionTitle.length);
        maxChoicesCount = Math.max(section.choices.length, maxChoicesCount);
        rows2[0].push({
          title: chalk.bold(sectionTitle),
          length: sectionTitle.length
        });
        section.choices.forEach((choice, choiceIdx) => {
          var _a;
          const isActive = sIdx === x && choiceIdx === y;
          const isSelected = selected[section.name] === choice.value;
          const choiceLength = choice.title.length + 4;
          const pointer = isActive ? prefix.pointer : " ";
          const cursor = isSelected ? template ? template.deprecationReason ? chalk.yellow(figures.radioOn) : chalk.green(figures.radioOn) : chalk.red(figures.radioOn) : style.placeholder(figures.radioOff);
          lengths2[sIdx] = Math.max(lengths2[sIdx], choiceLength);
          rows2[_a = choiceIdx + 1] || (rows2[_a] = sections.map(() => ({ title: "", length: 0 })));
          rows2[choiceIdx + 1][sIdx] = {
            title: spaces(
              pointer,
              cursor,
              isSelected ? chalk.bold(choice.title) : chalk.dim(choice.title)
            ),
            length: choiceLength
          };
        });
      });
      return [lengths2, rows2];
    }, [x, y, selected]);
    const horizontalColumnLines = lengths.map((l) => {
      return LINE_HOR.repeat(l + PADDING_HOR_LEFT + PADDING_HOR_RIGHT);
    });
    const paddingLeft = " ".repeat(PADDING_HOR_LEFT);
    const paddingRight = " ".repeat(PADDING_HOR_RIGHT);
    const message = spaces(
      prefix[completed ? "done" : "idle"],
      style.message("Preferred technologies:", "idle")
    );
    if (completed) {
      const lang = findTitleByNameAndValue("language", template.language);
      const framework = findTitleByNameAndValue("framework", template.framework);
      const sdk = findTitleByNameAndValue("sdk", template.sdk);
      return spaces(
        // Message.
        message,
        // Selected technologies.
        `${chalk.bold.blue(framework)}, ${chalk.bold.blue(lang)} and ${chalk.bold.blue(sdk)}`
      );
    }
    useKeypress((key) => {
      if (isSpaceKey(key)) {
        const section = sections[x];
        return setSelected({
          ...selected,
          [section.name]: section.choices[y].value
        });
      }
      if (isEnterKey(key)) {
        if (template) {
          done(template);
          setCompleted(true);
        }
      }
      if (isUpKey(key)) {
        setY(y === 0 ? maxY : y - 1);
        return;
      }
      if (isDownKey(key)) {
        setY(y === maxY ? 0 : y + 1);
        return;
      }
      if (key.name === "right") {
        const nextX = x === sections.length - 1 ? 0 : x + 1;
        const section = sections[nextX];
        if (y >= section.choices.length) {
          setY(section.choices.length - 1);
        }
        return setX(nextX);
      }
      if (key.name === "left") {
        const nextX = x === 0 ? sections.length - 1 : x - 1;
        const section = sections[nextX];
        if (y >= section.choices.length) {
          setY(section.choices.length - 1);
        }
        return setX(nextX);
      }
    });
    return lines(
      // Message.
      message,
      // Upper border.
      [CORNER_TOP_LEFT, horizontalColumnLines.join(LINE_HOR_T_DOWN), CORNER_TOP_RIGHT].join(""),
      // Table body.
      rows.map((row) => [
        // Cell left border.
        LINE_VER,
        paddingLeft,
        row.map((cell, columnIdx) => cell.title + " ".repeat(lengths[columnIdx] - cell.length)).join(`${paddingRight}${LINE_VER}${paddingLeft}`),
        paddingRight,
        // Cell right border.
        LINE_VER
      ].join("")),
      // Lower border.
      [CORNER_BOTTOM_LEFT, horizontalColumnLines.join(LINE_HOR_T_UP), CORNER_BOTTOM_RIGHT].join(""),
      // Help tip.
      [
        `${style.key("space")} to select`,
        style.key(figures.arrowUp),
        style.key(figures.arrowDown),
        `${style.key(figures.arrowLeft)} and ${style.key(figures.arrowDown)} to change the cursor`
      ].join(", "),
      new Separator().separator,
      // Deprecation warning.
      template && template.deprecationReason ? style.warning(template.deprecationReason) : void 0,
      // Selection status.
      template ? style.success(`A template using these technologies was discovered. Press ${style.key(
        "enter"
      )} to proceed.`) : style.error("Unable to find a template using these technologies"),
      style.help(
        "According to selected technologies, the CLI tool will pick a corresponding template, which will be used as a base for your application."
      ),
      ansiEscapes.cursorHide
    );
  }
);
const input = createPrompt(({
  theme,
  default: defaultValue,
  message,
  validate,
  hint,
  required
}, done) => {
  const { style, prefix } = makeTheme(theme);
  const [value, setValue] = useState("");
  const [error, setError] = useState();
  const [completed, setCompleted] = useState(false);
  function confirm(value2) {
    setValue(value2);
    setError(void 0);
    setCompleted(true);
    done(value2);
  }
  useEffect(() => {
    completed && done(value);
  }, [completed, done, value]);
  useKeypress((key, rl) => {
    if (isEnterKey(key)) {
      if (error) {
        return rl.write(value);
      }
      return value ? confirm(value) : defaultValue ? confirm(defaultValue) : required ? setError("The value must be provided") : confirm("");
    }
    if (key.name === "tab" && !value) {
      rl.clearLine(0);
      const v = defaultValue || "";
      rl.write(v);
      setValue(v);
      return;
    }
    const input2 = rl.line;
    setError(input2 && validate && validate(input2) || void 0);
    setValue(input2);
  });
  return [
    spaces(
      prefix[completed ? "done" : "idle"],
      message && style.message(message, "idle"),
      // TODO: We need some specific style for it.
      style.placeholder(completed ? figures.ellipsis : figures.pointerSmall),
      completed ? style.answer(value) : value || (defaultValue ? style.defaultAnswer(defaultValue) : "")
    ),
    completed ? void 0 : lines(hint && style.help(hint), error && style.error(error))
  ];
});
function createCustomTheme() {
  return makeTheme({
    style: {
      error(text) {
        return chalk.red(text);
      },
      success(text) {
        return chalk.green(text);
      },
      placeholder(text) {
        return chalk.dim(text);
      },
      warning(text) {
        return chalk.yellow(`${figures.warning} ${text}`);
      }
    },
    prefix: {
      idle: chalk.blue("?"),
      done: chalk.green(figures.tick),
      pointer: figures.arrowRight
    }
  });
}
const name = "@tma.js/create-mini-app";
const version = "1.0.1";
const description = "CLI tool to scaffold your new mini application on the Telegram Mini Apps platform.";
const packageJson = {
  name,
  version,
  description
};
program.name(packageJson.name).description(packageJson.description).version(packageJson.version).action(async () => {
  const theme = createCustomTheme();
  if (!await isGitInstalled()) {
    console.log(
      theme.style.error(
        "To run this CLI tool, you must have git installed. Installation guide: https://git-scm.com/book/en/v2/Getting-Started-Installing-Git"
      )
    );
    process.exit(1);
  }
  let rootDir = null;
  try {
    rootDir = await input({
      message: "Directory name:",
      required: true,
      default: "mini-app",
      hint: "This directory will be used as a root directory for the project. It is allowed to use alphanumeric latin letters, dashes and dots.",
      theme,
      validate(value) {
        if ([".", ".."].includes(value)) {
          return "Value is not a valid directory name";
        }
        if (!value.match(/^[a-zA-Z0-9\-.]+$/)) {
          return "Value contains invalid symbols";
        }
        if (existsSync(resolve(value))) {
          return `Directory "${value}" already exists`;
        }
      }
    });
  } catch {
    process.exit(0);
  }
  let repository;
  try {
    const { repository: promptRepo } = await promptTemplate({ theme });
    repository = promptRepo;
  } catch {
    process.exit(0);
  }
  let gitRepo;
  try {
    gitRepo = await input({
      message: "Git remote repository URL:",
      validate(value) {
        if (value.match(/\w+@[\w\-.]+:[\w-]+\/[\w./]+/)) {
          return;
        }
        try {
          new URL(value);
          return "";
        } catch {
          return "Value is not considered as URL link or SSH connection string.";
        }
      },
      theme,
      hint: lines(
        "This value will be used to connect created project with your remote Git repository. It should either be an HTTPS link or SSH connection string.",
        `Leave value empty and press ${theme.style.key("enter")} to skip this step.`,
        chalk.bold("Examples"),
        "SSH: git@github.com:user/repo.git",
        "URL: https://github.com/user/repo.git"
      )
    });
  } catch {
    process.exit(0);
  }
  try {
    await cloneTemplate(rootDir, repository, theme);
  } catch {
    process.exit(1);
  }
  try {
    await spawnWithSpinner({
      message: "Removing the .git directory.",
      command: () => rm(resolve(rootDir, ".git"), { recursive: true }),
      messageFail: (err) => `Failed to remove the .git directory. Error: ${err}`,
      messageSuccess: ".git directory removed.",
      theme
    });
  } catch {
    process.exit(1);
  }
  if (gitRepo) {
    try {
      await spawnWithSpinner({
        message: `Initializing Git repository: ${gitRepo}`,
        command: [
          `cd "${rootDir}"`,
          "git init",
          `git remote add origin "${gitRepo}"`
        ].join(" && "),
        messageFail: (error) => `Failed to initialize Git repository. ${error}`,
        messageSuccess: `Git repository initialized. Remote "origin" was set to "${gitRepo}"`,
        theme
      });
    } catch {
    }
  }
  console.log(
    lines(
      chalk.green.bold("Your project has been successfully initialized!"),
      `Now, open the "${chalk.bold(rootDir)}" directory and follow the instructions presented in the ${chalk.bold(
        "README.md"
      )} file. ${chalk.bold("Happy coding! 🚀")}`
    )
  );
});
program.parse();
