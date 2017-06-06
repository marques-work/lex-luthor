(function () {
  "use strict";

  const Lex = require("./luthor");
  const fs = require("fs");

  const Types = (function TypeHelper() {
    function checkTypeAndValue(token, type, value) {
      return token && type === token.type && ("undefined" === typeof(value) || value === token.value);
    }

    return {
      isPunc: function isPunc(token, value) {
        return checkTypeAndValue(token, "punc", value);
      },

      isOp: function isOp(token, value) {
        return checkTypeAndValue(token, "op", value);
      },

      isId: function isId(token, value) {
        return checkTypeAndValue(token, "id", value);
      },

      isKw: function isKw(token, value) {
        return checkTypeAndValue(token, "kw", value);
      },

      isOneOfType: function isOneOfType(token, types) {
        return -1 !== types.indexOf(token.type);
      }
    };
  })();

  /**
   * Hash that relates operators to their relative binding powers (a.k.a. "precedence")
   */
  const PRECEDENCE = {
    "=": 1,
    "||": 5,
    "&&": 10,
    "<": 15, ">": 15, "<=": 15, ">=": 15, "==": 15, "!=": 15,
    "+": 20, "-": 20,
    "*": 25, "/": 25, "%": 25,
  };

  const Nodes = {
    blockStatement: function(body) {
      return {type: "block", body: body};
    },

    invocation: function (node, args) {
      return {type: "call", func: node, args: args};
    },

    rule: function(name, args, body) {
      return {type: "rule", name: name, args: args, body: body};
    },

    binaryExpression: function(op, left, right) {
      var type = "=" === op ? "assign" : "binaryExpression";
      return {type: type, op: op, left: left, right: right};
    },

    bool: function(value) {
      return {type: "bool", value: value};
    }
  };

  function Parsicle(stream) {
    var ast = [];

    function parse() {
      ast.push(expression());

      while (!stream.eof()) {
        ast.push(expression());
        if (!stream.eof()) expectPunc(";");
      }

      return ast;
    }

    function expression() {
      return handleInvocation(function () {
        return resolveOperatorBindings(discrete(), 0);
      });
    }

    function parenthetical() {
      var exp;

      expectPunc("(");
      exp = expression();
      expectPunc(")");

      return exp;
    }

    function block() {
      var body = delimited("{", "}", ";", expression);
      if (1 === body.length) return body[0];
      return Nodes.blockStatement(body);
    }

    function rule() {
      var name;
      stream.next(); // advance past the "rule" keyword

      if (Types.isId(stream.peek())) {
        name = expectIdentifier().value;
      }

      if (!Types.isPunc(stream.peek(), "(")) stream.die("Missing argument list for rule declaration");

      var args = delimited("(", ")", ",", expectIdentifier);

      if (!Types.isPunc(stream.peek(), "{")) stream.die("Missing body for rule declaration");

      return Nodes.rule(name, args, block());
    }

    function signed() {
      var sign = expectOps(["-", "+"]);
      var token = stream.peek();

      if (!(Types.isPunc(token, "(") || Types.isOneOfType(token, ["num", "id"]))) stream.die("Expected signed expression");

      if ("-" === sign.value) {
        return Nodes.binaryExpression("*", -1, discrete());
      }

      return discrete();
    }

    function discrete() {
      return handleInvocation(function() {
        var current = stream.peek();

        if (Types.isPunc(current, "(")) {
          return parenthetical();
        }

        if (Types.isPunc(current, "{")) {
          return block();
        }

        if (Types.isKw(current, "rule")) {
          return rule();
        }

        if (Types.isOp(current, "-") || Types.isOp(current, "+")) {
          return signed();
        }

        if (Types.isOneOfType(current, ["num", "str", "id"])) {
          return stream.next();
        }

        die();
      });
    }

    function delimited(start, stop, separator, parserFn) {
      var token, body = [], first = true;

      expectPunc(start);
      while (!stream.eof()) {
        token = stream.peek();
        if (Types.isPunc(token, stop)) break;
        if (first) first = false; else expectPunc(separator);

        // can't use 'token' -- need to call peek() again as the current token changes after expectPunc()
        // is invoked in the previous check
        if (Types.isPunc(stream.peek(), stop)) break;
        body.push(parserFn());
      }
      expectPunc(stop);

      return body;
    }

    function expectIdentifier() {
      var token = stream.peek();
      if (!Types.isId(token)) stream.die("Expected an identifier");
      return stream.next();
    }

    function expectOps(operators) {
      var token = stream.peek();
      if (!Types.isOp(token) || -1 === operators.indexOf(token.value)) stream.die("Expected one of these operators: " + JSON.stringify(operators));
      return stream.next();
    }

    function expectPunc(char) {
      if (!Types.isPunc(stream.peek(), char)) stream.die("Expected \"" + char + "\"");

      return stream.next();
    }

    /**
     * Wraps a function, and tests if yields a function invocation expression or a normal expression. Either creates a
     * function invocation node, or leaves the result as-is.
     */
    function handleInvocation(callable) {
      var node = callable();

      if (Types.isPunc(stream.peek(), "(")) {
        var args = delimited("(", ")", ",", expression);
        return Nodes.invocation(node, args);
      }

      return node;
    }

    /**
     * Handles arithmetic operator precedence by grouping 2 expressions and the infixed operator if said operator's
     * precedence is higher than that of the preceding operator. This is necessary as the tokens are read from left to
     * right.
     *
     * Conceptually, this turns `1 + 2 * 3` into `1 + (2 * 3)`, which would otherwise be interpreted from in a left-to-right
     * parser as `(1 + 2) * 3`.
     */
    function resolveOperatorBindings(leftNode, thisPrecedence) {
      var token = stream.peek();

      if (Types.isOp(token)) {
        var op = token.value, thatPrecedence = PRECEDENCE[op];

        if (thatPrecedence > thisPrecedence) {
          stream.next(); // advance past operator

          var rightNode = resolveOperatorBindings(discrete(), thatPrecedence);
          var grouped = Nodes.binaryExpression(op, leftNode, rightNode);

          return resolveOperatorBindings(grouped, thisPrecedence);
        }
      }

      return leftNode;
    }

    function die() {
      stream.die("Unexpected token: " + JSON.stringify(stream.peek(), null, 2));
    }

    return { parse: parse, die: die };
  }


  var content = fs.readFileSync("example.js", "utf-8");

  console.log("=========== RAW CONTENT ===========");
  console.log(content);
  console.log("===================================");

  var lex = new Lex.Luthor(new Lex.CharStream(content));

  var result = new Parsicle(lex).parse();

  console.log("============== PARSED =============");
  console.log(JSON.stringify(result, null, 2));
  console.log("===================================");

  console.log("done");


  module.exports = {
    Parsicle: Parsicle
  };

})();
