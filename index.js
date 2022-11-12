let pyodide;
let isPyodideLoading = true;
let isSympyLoading = true;

loadPyodide().then((loadedPyodide) => {
  pyodide = loadedPyodide;
  isPyodideLoading = false;
  pyodide.loadPackage("sympy").then(() => (isSympyLoading = false));
});

let balanceCounter = 0;

const reactantsInput = document.getElementById("reactants");
const reactantsError = document.getElementById("reactants-error");

const productsInput = document.getElementById("products");
const productsError = document.getElementById("products-error");

const outputSpan = document.getElementById("output");

const validationRegex =
  /^([A-Z][a-z]?([1-9][0-9]*?)?){1,}(\s?\+\s?([A-Z][a-z]?([1-9][0-9]*?)?){1,})*?$/;

const checkFormat = (reactants, products) => {
  reactantsError.innerHTML = "";
  productsError.innerHTML = "";

  let errors = false;

  if (!validationRegex.test(reactants)) {
    reactantsError.innerHTML = "Input does not match expected format";
    errors = true;
  }

  if (!validationRegex.test(products)) {
    productsError.innerHTML = "Input does not match expected format";
    errors = true;
  }

  return errors;
};

const parseString = (inputString) => {
  const expression = [];

  const molecules = inputString.split("+");

  let currentAtoms;
  let currentMolecule;
  let currentAtom;
  let currentCount;

  for (let i = 0; i < molecules.length; i++) {
    currentMolecule = molecules[i];
    currentAtoms = new Map();

    currentAtom = "";
    currentCount = "";

    for (let j = 0; j < currentMolecule.length; j++) {
      const char = currentMolecule.charAt(j);

      if (/[A-Z]/.test(char)) {
        if (currentAtom === "") {
          currentAtom = char;
          continue;
        }

        currentAtoms.set(
          currentAtom,
          currentCount === "" ? 1 : Number(currentCount)
        );
        currentAtom = char;
        currentCount = "";
      } else if (/[a-z]/.test(char)) {
        currentAtom += char;
      } else if (char === "+") {
        currentAtoms.set(
          currentAtom,
          currentCount === "" ? 1 : Number(currentCount)
        );
        currentAtom = "";
        currentCount = "";
      } else if (/[0-9]/.test(char)) {
        currentCount += char;
      }
    }

    if (currentAtom !== "") {
      currentAtoms.set(
        currentAtom,
        currentCount === "" ? 1 : Number(currentCount)
      );
    }

    expression.push(currentAtoms);
  }

  return expression;
};

const compareAtoms = (reactantsExpression, productsExpression) => {
  const missingAnyFromReactants = reactantsExpression.some((reactantsAtoms) => {
    for (let reactantsAtom of reactantsAtoms.keys()) {
      const atomFoundInProducts = productsExpression.some((productsAtoms) => {
        for (let productsAtom of productsAtoms.keys()) {
          if (productsAtom === reactantsAtom) return true;
        }
        return false;
      });
      if (!atomFoundInProducts) return true;
    }
    return false;
  });

  if (missingAnyFromReactants) {
    reactantsError.innerHTML = "Not all atoms from input appears in products";
  }

  const missingAnyFromProducts = productsExpression.some((productsAtoms) => {
    for (let productsAtom of productsAtoms.keys()) {
      const atomFoundInReactants = reactantsExpression.some(
        (reactantsAtoms) => {
          for (let reactantsAtom of reactantsAtoms.keys()) {
            if (reactantsAtom === productsAtom) return true;
          }
          return false;
        }
      );
      if (!atomFoundInReactants) return true;
    }
    return false;
  });

  if (missingAnyFromProducts) {
    productsError.innerHTML = "Not all atoms from input appears in reactants";
  }

  return missingAnyFromReactants || missingAnyFromProducts;
};

const calculateCoefficients = (reactantsExpression, productsExpression) => {
  balanceCounter++;
  let expressions = {
    reactants_expression: reactantsExpression,
    products_expression: productsExpression,
  };
  pyodide.registerJsModule(`expressions${balanceCounter}`, expressions);
  pyodide.runPython(`
        from expressions${balanceCounter} import reactants_expression, products_expression
        from sympy import Matrix
        import sympy

        reactants_expression = reactants_expression.to_py()
        products_expression = products_expression.to_py()

        total_reactants_molecules = len(reactants_expression)
        total_products_molecules = len(products_expression)

        total_molecules = total_reactants_molecules + total_products_molecules

        symbols = sympy.symbols(",".join(map(str, range(1, total_molecules + 1))))

        atoms = set(item for sub in map(lambda x: map(str, x.keys()), reactants_expression) for item in sub)

        equations = []

        for atom in atoms:
            equations.append(list(map(lambda x: x.get(atom, 0), reactants_expression)) + list(map(lambda x: -x.get(atom, 0), products_expression)))
        
        A = Matrix(equations)
        b = Matrix([0 for _ in range(total_molecules)])

        tup = next(iter(sympy.linsolve((A, b), symbols)))

        coefficients = [x.as_coeff_Mul()[0] for x in tup]

        for x in range(1, 1000):
            new_coefficients = [coefficient * x for coefficient in coefficients]
            if all(coefficient.is_integer and coefficient >= 1 for coefficient in new_coefficients):
                result = new_coefficients
                break
        else:
          result = [0]
                
    `);
  return pyodide.globals
    .get("result")
    .toJs()
    .map((coefficient) => coefficient.toString());
};

const balanceEquation = () => {
  if (isPyodideLoading || isSympyLoading) return;

  reactants = reactantsInput.value;
  products = productsInput.value;

  const errors = checkFormat(reactants, products);
  if (errors) return;

  const reactantsExpression = parseString(reactants);
  const productsExpression = parseString(products);

  const anyMissingAtoms = compareAtoms(reactantsExpression, productsExpression);
  if (anyMissingAtoms) return true;

  const coefficients = calculateCoefficients(
    reactantsExpression,
    productsExpression
  );

  if (coefficients.some((coefficient) => coefficient === "0")) {
    reactantsError.innerHTML = "Couldn't balance equation";
    productsError.innerHTML = "Couldn't balance equation";
    return;
  }

  let idx = 0;
  const expressions = [
    reactantsExpression
      .map((atoms) => {
        let result = coefficients[idx] === "1" ? "" : coefficients[idx];
        idx++;

        for (let [name, amount] of atoms) {
          result += `${name}<sub>${amount === 1 ? "" : amount}</sub>`;
        }

        return result;
      })
      .join(" + "),
    productsExpression
      .map((atoms) => {
        let result = coefficients[idx] === "1" ? "" : coefficients[idx];
        idx++;

        for (let [name, amount] of atoms) {
          result += `${name}<sub>${amount === 1 ? "" : amount}</sub>`;
        }

        return result;
      })
      .join(" + "),
  ];

  outputSpan.innerHTML = expressions.join(" → ");
};
