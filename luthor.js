(function() {
  "use strict";

  /**
   * Custom exception for malformed syntax
   */
  function IllegalSyntaxError(line, col, message) {
    this.message = "at (" + line + ":" + col + "): " + message;

    if ("captureStackTrace" in Error) {
      Error.captureStackTrace(this, IllegalSyntaxError);
    } else {
      this.stack = (new Error()).stack;
    }
  }

  IllegalSyntaxError.prototype = Object.create(Error.prototype);
  IllegalSyntaxError.prototype.name = "IllegalSyntaxError";
  IllegalSyntaxError.prototype.constructor = IllegalSyntaxError;

  /**
   * a stupidly simple character-wise streamer with the ability to peek() at the current
   * character before advancing the stream cursor.
   *
   * Limitations: input is a string, so can't handle large inputs. Need to implement using Stream.Readable.
   */
  function CharStream(stringOrReadable) {
    var pos  = 0 /* position in the stream */,
        line = 1,
        col  = 0; /* position in the line */

    var peek = ("string" === typeof stringOrReadable) ? stringPeek : readablePeek;

    function next() {
      var char = peek();
      ++pos;

      if ("\n" === char) {
        ++line;
        col = 0;
      } else {
        ++col;
      }

      return char;
    }

    function stringPeek() {
      return stringOrReadable.charAt(pos);
    }

    function readablePeek() {
      return stringOrReadable.read(1);
    }

    function eof() {
      return "" === peek();
    }

    function die(msg) {
      throw new IllegalSyntaxError(line, col, msg);
    }

    return { next: next, peek: peek, eof: eof, die: die };
  }

  var Values = (function ValueHelpers() {
    function readWhile(stream, predicate) {
      var str = "";

      while (!stream.eof() && predicate(stream.peek())) {
        str += stream.next();
      }

      return str;
    }

    function skipRestOfLine(stream) {
      readWhile(stream, Matchers.isNotEOL);
      stream.next(); // advance past EOL
    }

    /*
     * Extracts positive numeric or zero values. Signed values should be
     * handled by the parser, not the lexer.
     */
    function readNumber(stream) {
      var hasDot = false;
      var number = readWhile(stream, function isNumeric(char) {
        if ("." === char) {
          if (hasDot) return false;

          hasDot = true;
          return true;
        }

        return Matchers.isDigit(char);
      });

      return parseFloat(number);
    }

    function readIdentifier(stream) {
      return readWhile(stream, Matchers.isIdentifier);
    }

    function readString(stream) {
      var escaped = false, str = "", char;
      stream.next();
      while (!stream.eof()) {
        char = stream.next();

        if (escaped) {
          str += char;
          escaped = false;
        } else if (char == "\\") {
          escaped = true;
        } else if (Matchers.isStringBoundary(char)) {
          break;
        } else {
          str += char;
        }
      }

      return str;
    }

    function readOperator(stream) {
      return readWhile(stream, Matchers.isOperator);
    }

    return {
      readWhile: readWhile,
      skipRestOfLine: skipRestOfLine,
      readNumber: readNumber,
      readIdentifier: readIdentifier,
      readString: readString,
      readOperator: readOperator
    };
  })();

  var Keywords = [
    "rule",
    "conform",
    "true",
    "false"
  ];

  var Matchers = (function TokenMatchers() {
    function isWhiteSpace(char) {
      return " \t\n".indexOf(char) !== -1;
    }

    function isComment(char) {
      return "#" === char;
    }

    function isNotEOL(char) {
      return "\n" !== char;
    }

    function isStringBoundary(char) {
      return "\"" === char;
    }

    function isDigit(char) {
      return /[0-9]/i.test(char);
    }

    function isStartOfIdentifier(char) {
      return /[a-z_]/i.test(char);
    }

    function isIdentifier(char) {
      return isStartOfIdentifier(char) || /[0-9\-\?\!]/.test(char);
    }

    function isPunctuation(char) {
       return ",:;(){}[]".indexOf(char) !== -1;
    }

    function isOperator(char) {
       return "+-*/%=&|<>!~^".indexOf(char) !== -1;
    }

    function isKeyword(identifier) {
      return Keywords.indexOf(identifier) !== -1;
    }

    return {
      isWhiteSpace: isWhiteSpace,
      isComment: isComment,
      isNotEOL: isNotEOL,
      isStringBoundary: isStringBoundary,
      isDigit: isDigit,
      isStartOfIdentifier: isStartOfIdentifier,
      isIdentifier: isIdentifier,
      isPunctuation: isPunctuation,
      isOperator: isOperator,
      isKeyword: isKeyword
    };
  })();

  function token(type, value) {
    return { type: type, value: value };
  }

  var Tokens = {
    string: function string(value) {
      return token("str", value);
    },

    numeric: function numeric(value) {
      return token("num", value);
    },

    identifier: function identifier(value) {
      return token("id", value);
    },

    keyword: function keyword(value) {
      return token("kw", value);
    },

    operator: function operator(value) {
      return token("op", value);
    },

    punctuation: function punctuation(value) {
      return token("punc", value);
    }
  };

  /**
   * Lexes a stream of characters into a stream of tokens
   */
  function Luthor(stream) {
    var current = null;

    function readNextToken() {
      Values.readWhile(stream, Matchers.isWhiteSpace);

      if (stream.eof()) return null;

      var char = stream.peek();

      if (Matchers.isComment(stream.peek())) {
        Values.skipRestOfLine(stream);
        return readNextToken();
      }

      if (Matchers.isStringBoundary(char)) {
        stream.next(); // advance past starting boundary
        return Tokens.string(Values.readString(stream));
      }

      if (Matchers.isDigit(char)) {
        return Tokens.numeric(Values.readNumber(stream));
      }

      if (Matchers.isStartOfIdentifier(char)) {
        var identifier = Values.readIdentifier(stream);
        return Matchers.isKeyword(identifier) ? Tokens.keyword(identifier) : Tokens.identifier(identifier);
      }

      if (Matchers.isPunctuation(char)) {
        return Tokens.punctuation(stream.next());
      }

      if (Matchers.isOperator(char)) {
        return Tokens.operator(Values.readOperator(stream));
      }

      stream.die("Illegal character at this position: " + char);
    }

    function peek() {
      return current || (current = readNextToken());
    }

    function next() {
      var token = current;
      current = null;
      return token || readNextToken();
    }

    function eof() {
      return null === peek();
    }

    function die(message) {
      stream.die(message);
    }

    return { next: next, peek: peek, eof: eof, die: die };
  }

  module.exports = {
    Luthor: Luthor,
    CharStream: CharStream
  };
})();
