const PREC = {
  range: 15,
  call: 14,
  field: 13,
  unary: 11,
  multiplicative: 10,
  additive: 9,
  shift: 8,
  bitand: 7,
  bitxor: 6,
  bitor: 5,
  comparative: 4,
  and: 3,
  or: 2,
  assign: 0,
  closure: -1,
}

const numeric_types = [
  'u8',
  'i8',
  'u16',
  'i16',
  'u32',
  'i32',
  'u64',
  'i64',
  'u128',
  'i128',
  'isize',
  'usize',
  'f32',
  'f64',
]

const primitive_types = numeric_types.concat(['bool', 'str', 'char'])

module.exports = grammar({
  name: 'rust',

  extras: $ => [/\s/, $.line_comment, $.block_comment],

  externals: $ => [
    $.string_content,
    $.raw_string_literal,
    $.float_literal,
    $.block_comment,
  ],

  supertypes: $ => [],

  inline: $ => [
    $._path,
    $._type_identifier,
    $._field_identifier,
    $._reserved_identifier,
    $._expression_ending_with_block,
  ],

  conflicts: $ => [
    // Local ambiguity due to anonymous types:
    // See https://internals.rust-lang.org/t/pre-rfc-deprecating-anonymous-parameters/3710
    [$.type_, $.pattern_],
    [$.unit_type, $.tuple_pattern],
    [$.scoped_identifier, $.scoped_type_identifier],
    [$.parameter, $.pattern_],
    [$.parameters, $.tuple_struct_pattern],
    [$.type_parameter, $.for_lifetimes],

    [$.type_parameter, $.type_],
    [$.primitive_type, $.pattern_],
    [$.primitive_type, $.primitive_type_identifiers],
    [$.empty_return, $.return],

    [$.untypeable_parameter, $.pattern_],
  ],

  word: $ => $.identifier_,

  rules: {
    program: $ =>
      optional_with_placeholder('statement_list', repeat($.statement)),

    statement: $ => choice($.expression_statement_, $.declaration_statement_),

    empty_statement: $ => ';',

    expression_statement_: $ =>
      choice(seq($.expression, ';'), prec(1, $._expression_ending_with_block)),

    declaration_statement_: $ =>
      choice(
        $.const_item,
        $.macro_invocation,
        $.macro_definition,
        $.empty_statement,
        $.attribute_item,
        $.inner_attribute_item,
        $.module,
        $.foreign_module,
        $.struct,
        $.union_item,
        $.enum,
        $.type_item,
        $.function,
        $.implementation,
        $.trait,
        $.associated_type,
        alias($.let_declaration, $.variable_declaration),
        $.use_declaration,
        $.extern_crate_declaration,
        $.static_item
      ),

    // Section - Macro definitions

    macro_definition: $ => {
      const rules = seq(repeat(seq($.macro_rule, ';')), optional($.macro_rule))

      return seq(
        'macro_rules!',
        field('name', choice($.identifier, $._reserved_identifier)),
        choice(seq('(', rules, ')', ';'), seq('{', rules, '}'))
      )
    },

    macro_rule: $ =>
      seq(
        field('left', $.token_tree_pattern),
        '=>',
        field('right', $.token_tree)
      ),

    _token_pattern: $ =>
      choice(
        $.token_tree_pattern,
        $.token_repetition_pattern,
        $.token_binding_pattern,
        $.non_special_token_
      ),

    token_tree_pattern: $ =>
      choice(
        seq('(', repeat($._token_pattern), ')'),
        seq('[', repeat($._token_pattern), ']'),
        seq('{', repeat($._token_pattern), '}')
      ),

    token_binding_pattern: $ =>
      prec(
        1,
        seq(
          field('name', $.metavariable),
          ':',
          field('type', $.fragment_specifier)
        )
      ),

    token_repetition_pattern: $ =>
      seq(
        '$',
        '(',
        repeat($._token_pattern),
        ')',
        optional(/[^+*?]+/),
        choice('+', '*', '?')
      ),

    fragment_specifier: $ =>
      choice(
        'block',
        'expr',
        'ident',
        'item',
        'lifetime',
        'literal',
        'meta',
        'pat',
        'path',
        'stmt',
        'tt',
        'ty',
        'vis'
      ),

    tokens_: $ =>
      choice(
        prec.dynamic(1, ','),
        field(
          'argument',
          choice($.token_tree, $.token_repetition, $.non_special_token_)
        )
      ),

    token_tree: $ =>
      choice($.token_tree_parens, $.token_tree_brackets, $.token_tree_braces),

    token_tree_parens: $ =>
      seq(
        '(',
        optional_with_placeholder('argument_list', repeat($.tokens_)),
        ')'
      ),

    token_tree_brackets: $ =>
      seq(
        '[',
        optional_with_placeholder('argument_list', repeat($.tokens_)),
        ']'
      ),

    token_tree_braces: $ =>
      seq(
        '{',
        optional_with_placeholder('argument_list', repeat($.tokens_)),
        '}'
      ),

    token_repetition: $ =>
      seq(
        '$',
        '(',
        repeat($.tokens_),
        ')',
        optional(/[^+*?]+/),
        choice('+', '*', '?')
      ),

    non_special_token_: $ =>
      choice(
        $.literal_,
        $.identifier,
        $.metavariable,
        $.mutable_specifier,
        $.self,
        $.super,
        $.crate,
        $.primitive_type,
        /[/_\-=->,;:::!=?.@*&#%^+<>|~]+/,
        "'",
        'as',
        'async',
        'await',
        'break',
        'const',
        'continue',
        'default',
        'enum',
        'fn',
        'for',
        'if',
        'impl',
        'let',
        'loop',
        'match',
        'mod',
        'pub',
        'return',
        'static',
        'struct',
        'trait',
        'type',
        'union',
        'unsafe',
        'use',
        'where',
        'while'
      ),

    // Section - Declarations

    attribute_item: $ => seq('#', '[', $.meta_item, ']'),

    inner_attribute_item: $ => seq('#', '!', '[', $.meta_item, ']'),

    meta_item: $ =>
      seq(
        $._path,
        optional(
          choice(
            seq('=', field('value', $.literal_)),
            field('arguments_with_parens', $.meta_arguments)
          )
        )
      ),

    meta_arguments: $ =>
      seq(
        '(',
        field(
          'argument_list',
          seq(sepBy(',', choice($.meta_item, $.literal_)), optional(','))
        ),
        ')'
      ),

    module: $ =>
      seq(
        optional_with_placeholder('modifier_list', $.visibility_modifier),
        'mod',
        field('name', $.identifier),
        choice(';', field('enclosed_body', $.module_member_block))
      ),

    module_member_block: $ =>
      seq(
        '{',
        optional_with_placeholder('module_member_list', $.declaration_list),
        '}'
      ),

    foreign_module: $ =>
      seq(
        optional_with_placeholder('modifier_list', $.visibility_modifier),
        $.extern_modifier,
        choice(
          ';',
          field('enclosed_body', seq('{', optional($.declaration_list), '}'))
        )
      ),

    declaration_list: $ => repeat1(alias($.declaration_statement_, $.member)),

    struct: $ =>
      seq(
        optional_with_placeholder('modifier_list', $.visibility_modifier),
        'struct',
        field('identifier', $._type_identifier),
        optional_with_placeholder(
          'type_parameter_list_optional',
          $.type_parameters
        ),
        choice(
          $.struct_field_declaration_variant,
          $.struct_ordered_field_declaration_variant,
          ';'
        )
      ),

    struct_field_declaration_variant: $ =>
      seq(
        optional_with_placeholder(
          'type_parameter_constraint_list_optional',
          $.where_clause
        ),
        field('enclosed_body', $.struct_field_declaration_list_block)
      ),

    struct_ordered_field_declaration_variant: $ =>
      seq(
        field('enclosed_body', $.struct_ordered_field_declaration_list_block),
        optional_with_placeholder(
          'type_parameter_constraint_list_optional',
          $.where_clause
        ),
        ';'
      ),

    union_item: $ =>
      seq(
        optional_with_placeholder('modifier_list', $.visibility_modifier),
        'union',
        field('name', $._type_identifier),
        optional_with_placeholder(
          'type_parameter_list_optional',
          $.type_parameters
        ),
        optional_with_placeholder(
          'type_parameter_constraint_list_optional',
          $.where_clause
        ),
        field('enclosed_body', $.field_declaration_list_block)
      ),

    enum: $ =>
      seq(
        optional_with_placeholder('modifier_list', $.visibility_modifier),
        'enum',
        field('name', $._type_identifier),
        optional_with_placeholder(
          'type_parameter_list_optional',
          $.type_parameters
        ),
        optional_with_placeholder(
          'type_parameter_constraint_list_optional',
          $.where_clause
        ),
        field('enclosed_body', $.enum_variant_list)
      ),

    enum_variant_list: $ =>
      seq(
        '{',
        optional_with_placeholder(
          'enum_member_list',
          seq(sepBy(',', alias($.enum_variant, $.member)), optional(','))
        ),
        '}'
      ),

    enum_variant: $ =>
      seq(
        repeat($.attribute_item),
        optional_with_placeholder('modifier_list', $.visibility_modifier),
        field('name', $.identifier),
        optional_with_placeholder(
          'enclosed_body',
          choice(
            $.enum_field_declaration_list_block,
            $.enum_ordered_field_declaration_list_block
          )
        ),
        optional(seq('=', field('value', $.expression)))
      ),

    struct_field_declaration_list_block: $ =>
      seq(
        '{',
        optional_with_placeholder(
          'struct_member_list',
          $.field_declaration_list
        ),
        '}'
      ),

    enum_field_declaration_list_block: $ =>
      seq(
        '{',
        optional_with_placeholder('enum_member_list', $.field_declaration_list),
        '}'
      ),

    field_declaration_list_block: $ =>
      seq(
        '{',
        optional_with_placeholder('member_list', $.field_declaration_list),
        '}'
      ),

    field_declaration_list: $ =>
      seq(
        sepBy1(',', field('member', seq(repeat($.attribute_item), $.property))),
        optional(',')
      ),

    property: $ =>
      seq(
        optional_with_placeholder('modifier_list', $.visibility_modifier),
        field('assignment_list', alias($.property_assignment, $.assignment))
      ),

    property_assignment: $ =>
      seq(
        field('assignment_variable', seq($._field_identifier, $.type_optional)),
        optional_with_placeholder(
          'assignment_value_list_optional',
          '!!UNMATCHABLE_20a83a3h0'
        )
      ),

    struct_ordered_field_declaration_list_block: $ =>
      seq(
        '(',
        optional_with_placeholder(
          'struct_member_list',
          $.ordered_field_declaration_list
        ),
        ')'
      ),

    enum_ordered_field_declaration_list_block: $ =>
      seq(
        '(',
        optional_with_placeholder(
          'enum_member_list',
          $.ordered_field_declaration_list
        ),
        ')'
      ),

    anonymous_property: $ =>
      seq(
        repeat($.attribute_item),
        optional_with_placeholder('modifier_list', $.visibility_modifier),
        field('type_optional', $.type_)
      ),

    ordered_field_declaration_list: $ =>
      field(
        'anonymous_property_list',
        seq(sepBy1(',', alias($.anonymous_property, $.member)), optional(','))
      ),

    extern_crate_declaration: $ =>
      seq(
        optional_with_placeholder('modifier_list', $.visibility_modifier),
        'extern',
        $.crate,
        field('name', $.identifier),
        optional(seq('as', field('alias', $.identifier))),
        ';'
      ),

    const_item: $ =>
      seq(
        optional_with_placeholder('modifier_list', $.visibility_modifier),
        'const',
        field('name', $.identifier),
        $.type_optional,
        optional(seq('=', field('assignment_value', $.expression))),
        ';'
      ),

    static_item: $ =>
      seq(
        optional_with_placeholder('modifier_list', $.visibility_modifier),
        'static',

        // Not actual rust syntax, but made popular by the lazy_static crate.
        optional('ref'),

        optional_with_placeholder('second_modifier_list', $.mutable_specifier),
        field('name', $.identifier),
        $.type_optional,
        optional(seq('=', field('value', $.expression))),
        ';'
      ),

    type_item: $ =>
      seq(
        optional_with_placeholder('modifier_list', $.visibility_modifier),
        'type',
        field('name', $._type_identifier),
        optional_with_placeholder(
          'type_parameter_list_optional',
          $.type_parameters
        ),
        '=',
        field('type', $.type_),
        ';'
      ),

    function_type_clause: $ => seq('->', field('type', $.type_)),

    function: $ =>
      seq(
        optional_with_placeholder(
          'modifier_list',
          seq(optional($.visibility_modifier), optional($.function_modifiers))
        ),
        'fn',
        field('name', choice($.identifier, $.metavariable)),
        optional_with_placeholder(
          'type_parameter_list_optional',
          $.type_parameters
        ),
        field('parameters', $.parameters),
        optional_with_placeholder(
          'return_type_optional',
          $.function_type_clause
        ),
        optional_with_placeholder(
          'type_parameter_constraint_list_optional',
          $.where_clause
        ),
        choice(';', $.enclosed_body)
      ),

    unsafe_modifier: $ => 'unsafe',

    function_modifier: $ =>
      field(
        'modifier',
        choice(
          'async',
          'default',
          'const',
          $.unsafe_modifier,
          $.extern_modifier
        )
      ),

    function_modifiers: $ => repeat1($.function_modifier),

    where_clause: $ =>
      seq(
        'where',
        field(
          'type_parameter_constraint_list',
          seq(
            sepBy1(
              ',',
              alias($.where_predicate, $.type_parameter_constraint_type)
            ),
            optional(',')
          )
        )
      ),

    where_predicate: $ =>
      seq(
        field(
          'left',
          choice(
            $.lifetime,
            $._type_identifier,
            $.scoped_type_identifier,
            $.generic_type,
            $.reference_type,
            $.pointer_type,
            $.tuple_type,
            $.higher_ranked_trait_bound,
            $.primitive_type
          )
        ),
        field('bounds', $.trait_bounds)
      ),

    impl_item_body: $ =>
      seq(
        '{',
        optional_with_placeholder(
          'implementation_member_list',
          optional($.declaration_list)
        ),
        '}'
      ),

    implements_list: $ =>
      seq(
        field(
          'implements_type',
          choice($._type_identifier, $.scoped_type_identifier, $.generic_type)
        )
      ),

    implementation: $ =>
      seq(
        optional_with_placeholder('modifier_list', $.unsafe_modifier),
        'impl',
        optional_with_placeholder(
          'type_parameter_list_optional',
          $.type_parameters
        ),
        optional_with_placeholder(
          'implements_list_optional',
          seq($.implements_list, 'for')
        ),
        field('identifier', $.type_), // Serenade: The class we're implementing the trait for.
        optional_with_placeholder(
          'type_parameter_constraint_list_optional',
          $.where_clause
        ),
        alias($.impl_item_body, $.enclosed_body)
      ),

    trait_item_body: $ =>
      seq(
        '{',
        optional_with_placeholder('trait_member_list', $.declaration_list),
        '}'
      ),

    trait: $ =>
      seq(
        optional_with_placeholder(
          'modifier_list',
          seq(optional($.visibility_modifier), optional($.unsafe_modifier))
        ),
        'trait',
        field('name', $._type_identifier),
        optional_with_placeholder(
          'type_parameter_list_optional',
          $.type_parameters
        ),
        optional_with_placeholder('trait_bounds_optional', $.trait_bounds),
        optional_with_placeholder(
          'type_parameter_constraint_list_optional',
          $.where_clause
        ),
        alias($.trait_item_body, $.enclosed_body)
      ),

    associated_type: $ =>
      seq(
        'type',
        field('name', $._type_identifier),
        optional_with_placeholder(
          'type_parameter_constraint_list_optional',
          $.trait_bounds
        ),
        ';'
      ),

    trait_bounds: $ =>
      seq(
        ':',
        field(
          'trait_bound',
          sepBy1(
            '+',
            choice(
              $.type_,
              $.lifetime,
              $.higher_ranked_trait_bound,
              $.removed_trait_bound
            )
          )
        )
      ),

    higher_ranked_trait_bound: $ =>
      seq(
        'for',
        field('type_parameters', $.type_parameters),
        field('type', $.type_)
      ),

    removed_trait_bound: $ => seq('?', $.type_),

    type_parameter: $ =>
      choice(
        $.lifetime,
        $.metavariable,
        $._type_identifier,
        $.constrained_type_parameter,
        $.optional_type_parameter,
        $.const_parameter
      ),

    type_parameters: $ =>
      prec(
        1,
        seq(
          '<',
          field(
            'type_parameter_list',
            seq(sepBy1(',', $.type_parameter), optional(','))
          ),
          '>'
        )
      ),

    const_parameter: $ =>
      seq('const', field('name', $.identifier), $.type_optional),

    constrained_type_parameter: $ =>
      seq(
        field('left', choice($.lifetime, $._type_identifier)),
        field('bounds', $.trait_bounds)
      ),

    optional_type_parameter: $ =>
      seq(
        field('name', choice($._type_identifier, $.constrained_type_parameter)),
        '=',
        field('default_type', $.type_)
      ),

    assignment: $ =>
      seq(
        field('assignment_variable', $.pattern_),
        optional_with_placeholder('type_optional', $.type_optional),
        optional_with_placeholder(
          'assignment_value_list_optional',
          seq('=', alias($.expression, $.assignment_value))
        )
      ),

    let_declaration: $ =>
      seq(
        'let',
        optional_with_placeholder('modifier_list', $.mutable_specifier),
        field('assignment_list', $.assignment),
        ';'
      ),

    using: $ =>
      seq(
        optional_with_placeholder('modifier_list', $.visibility_modifier),
        'use',
        $.use_clause
      ),

    use_declaration: $ => seq($.using, ';'),

    use_clause: $ =>
      choice(
        $._path,
        $.use_as_clause,
        $.use_list,
        $.scoped_use_list,
        $.use_wildcard
      ),

    scoped_use_list: $ =>
      seq(optional(field('path', $._path)), '::', $.use_list),

    use_list: $ =>
      seq(
        '{',
        optional_with_placeholder('use_clause_list', sepBy1(',', $.use_clause)),
        optional(','),
        '}'
      ),

    use_as_clause: $ =>
      seq(field('path', $._path), 'as', field('alias', $.identifier)),

    use_wildcard: $ => seq(optional(seq($._path, '::')), '*'),

    parameter: $ =>
      seq(
        optional($.attribute_item),
        choice(
          $.simple_parameter,
          $.self_parameter,
          $.untyped_parameter,
          $.untypeable_parameter
        )
      ),

    untyped_parameter: $ =>
      seq(
        field('identifier', $.type_),
        optional_with_placeholder('type_optional', '!!UNMATCHABLE_7ag3f923a297')
      ),

    untypeable_parameter: $ =>
      field('identifier', choice($.variadic_parameter, '_')),

    parameters: $ =>
      seq(
        '(',
        optional_with_placeholder(
          'parameter_list',
          seq(sepBy(',', $.parameter), optional(','))
        ),
        ')'
      ),

    self_parameter: $ =>
      seq(
        optional('&'),
        optional($.lifetime),
        optional_with_placeholder('modifier_list', $.mutable_specifier),
        field('identifier', $.self)
      ),

    variadic_parameter: $ => '...',

    simple_parameter: $ =>
      seq(
        optional_with_placeholder('modifier_list', $.mutable_specifier),
        field('identifier', choice($.pattern_, $.self, $._reserved_identifier)),
        $.type_optional
      ),

    extern_modifier: $ => seq('extern', optional($.string_literal)),

    visibility_modifier: $ =>
      prec.right(
        field(
          'modifier',
          choice(
            $.crate,
            seq(
              'pub',
              optional(
                seq(
                  '(',
                  choice($.self, $.super, $.crate, seq('in', $._path)),
                  ')'
                )
              )
            )
          )
        )
      ),

    // Section - Types

    type_: $ =>
      choice(
        $.abstract_type,
        $.reference_type,
        $.metavariable,
        $.pointer_type,
        $.generic_type,
        $.scoped_type_identifier,
        $.tuple_type,
        $.unit_type,
        $.array_type,
        $.function_type,
        $._type_identifier,
        $.macro_invocation,
        $.empty_type,
        $.dynamic_type,
        $.bounded_type,
        $.primitive_type
      ),

    type_optional: $ => seq(':', field('type', $.type_)),

    bracketed_type: $ => seq('<', choice($.type_, $.qualified_type), '>'),

    qualified_type: $ =>
      seq(field('type', $.type_), 'as', field('alias', $.type_)),

    lifetime: $ => seq("'", $.identifier),

    array_type: $ =>
      seq(
        '[',
        field('element', $.type_),
        optional(seq(';', field('length', $.expression))),
        ']'
      ),

    for_lifetimes: $ =>
      seq('for', '<', sepBy1(',', $.lifetime), optional(','), '>'),

    function_type: $ =>
      seq(
        optional($.for_lifetimes),
        prec(
          PREC.call,
          seq(
            choice(
              field(
                'implements_type',
                choice($._type_identifier, $.scoped_type_identifier)
              ),
              seq(optional($.function_modifiers), 'fn')
            ),
            field('parameters', $.parameters)
          )
        ),
        optional_with_placeholder(
          'return_type_optional',
          $.function_type_clause
        )
      ),

    primitive_type: $ => choice(...primitive_types),

    tuple_type: $ => seq('(', sepBy1(',', $.type_), optional(','), ')'),

    unit_type: $ => seq('(', ')'),

    generic_function: $ =>
      prec(
        1,
        seq(
          field(
            'function_',
            choice($.identifier, $.scoped_identifier, $.field_expression)
          ),
          '::',
          field('type_arguments', $.type_arguments)
        )
      ),

    generic_type: $ =>
      prec(
        1,
        seq(
          field('type', choice($._type_identifier, $.scoped_type_identifier)),
          field('type_arguments', $.type_arguments)
        )
      ),

    generic_type_with_turbofish: $ =>
      seq(
        field('type', choice($._type_identifier, $.scoped_identifier)),
        '::',
        field('type_arguments', $.type_arguments)
      ),

    bounded_type: $ =>
      prec.left(
        -1,
        choice(
          seq($.lifetime, '+', $.type_),
          seq($.type_, '+', $.type_),
          seq($.type_, '+', $.lifetime)
        )
      ),

    type_arguments: $ =>
      seq(
        token(prec(1, '<')),
        field(
          'type_argument_list',
          sepBy1(
            ',',
            alias(
              choice(
                $.type_,
                $.type_binding,
                $.lifetime,
                $.literal_,
                $.enclosed_body
              ),
              $.type_argument
            )
          )
        ),
        optional(','),
        '>'
      ),

    type_binding: $ =>
      seq(field('name', $._type_identifier), '=', field('type', $.type_)),

    reference_type: $ =>
      seq(
        '&',
        optional($.lifetime),
        optional_with_placeholder('modifier_list', $.mutable_specifier),
        field('type', $.type_)
      ),

    pointer_type: $ =>
      seq('*', choice('const', $.mutable_specifier), field('type', $.type_)),

    empty_type: $ => '!',

    abstract_type: $ =>
      seq(
        'impl',
        field(
          'implements_type',
          choice(
            $._type_identifier,
            $.scoped_type_identifier,
            $.generic_type,
            $.function_type
          )
        )
      ),

    dynamic_type: $ =>
      seq(
        'dyn',
        field(
          'implements_type',
          choice(
            $._type_identifier,
            $.scoped_type_identifier,
            $.generic_type,
            $.function_type
          )
        )
      ),

    mutable_specifier: $ => field('modifier', 'mut'),

    // Section - Expressions

    expression: $ =>
      choice(
        $.unary_expression,
        $.reference_expression,
        $.try_expression,
        $.binary_expression,
        $.assignment_expression,
        $.compound_assignment_expr,
        $.type_cast_expression,
        $.range_expression,
        alias($.call_expression, $.call),
        $.return,
        $.literal_,
        prec.left($.identifier),
        $.primitive_type_identifiers,
        prec.left($._reserved_identifier),
        $.self,
        $.scoped_identifier,
        $.generic_function,
        $.await_expression,
        $.field_expression,
        $.array_expression,
        $.tuple_expression,
        prec(1, $.macro_invocation),
        $.unit_expression,
        $._expression_ending_with_block,
        $.break_expression,
        $.continue_expression,
        $.index_expression,
        $.metavariable,
        $.lambda,
        $.parenthesized_expression,
        $.struct_expression
      ),

    _expression_ending_with_block: $ =>
      choice(
        $.unsafe_block,
        $.async_block,
        $.enclosed_body,
        $.if,
        $.match_expression,
        $.while,
        $.loop,
        $.for,
        $.const_block
      ),

    macro_invocation: $ =>
      field(
        'call', // tag the same way as regular calls...
        seq(
          choice($.scoped_identifier, $.identifier, $._reserved_identifier),
          '!',
          $.token_tree
        )
      ),

    scoped_identifier: $ =>
      seq(
        optional(
          choice(
            $._path,
            $.bracketed_type,
            alias($.generic_type_with_turbofish, $.generic_type)
          )
        ),
        '::',
        field('name', $.identifier)
      ),

    scoped_type_identifier_in_expression_position: $ =>
      prec(
        -2,
        seq(
          optional(
            choice(
              $._path,
              alias($.generic_type_with_turbofish, $.generic_type)
            )
          ),
          '::',
          field('name', $._type_identifier)
        )
      ),

    scoped_type_identifier: $ =>
      seq(
        optional(
          choice(
            $._path,
            alias($.generic_type_with_turbofish, $.generic_type_duplicate),
            $.bracketed_type,
            $.generic_type
          )
        ),
        '::',
        field('name', $._type_identifier)
      ),

    range_expression: $ =>
      prec.left(
        PREC.range,
        choice(
          prec.left(
            PREC.range + 1,
            seq($.expression, choice('..', '...', '..='), $.expression)
          ),
          seq($.expression, '..'),
          seq('..', $.expression),
          '..'
        )
      ),

    unary_expression: $ =>
      prec(PREC.unary, seq(choice('-', '*', '!'), $.expression)),

    try_expression: $ => seq($.expression, '?'),

    reference_expression: $ =>
      prec(
        PREC.unary,
        seq(
          '&',
          optional_with_placeholder('modifier_list', $.mutable_specifier),
          field('value', $.expression)
        )
      ),

    binary_expression: $ => {
      const table = [
        [PREC.and, '&&'],
        [PREC.or, '||'],
        [PREC.bitand, '&'],
        [PREC.bitor, '|'],
        [PREC.bitxor, '^'],
        [PREC.comparative, choice('==', '!=', '<', '<=', '>', '>=')],
        [PREC.shift, choice('<<', '>>')],
        [PREC.additive, choice('+', '-')],
        [PREC.multiplicative, choice('*', '/', '%')],
      ]

      return choice(
        ...table.map(([precedence, operator]) =>
          prec.left(
            precedence,
            seq(
              field('left', $.expression),
              field('operator', operator),
              field('right', $.expression)
            )
          )
        )
      )
    },

    assignment_expression: $ =>
      prec.left(
        PREC.assign,
        seq(field('left', $.expression), '=', field('right', $.expression))
      ),

    compound_assignment_expr: $ =>
      prec.left(
        PREC.assign,
        seq(
          field('left', $.expression),
          field(
            'operator',
            choice('+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=')
          ),
          field('right', $.expression)
        )
      ),

    type_cast_expression: $ =>
      seq(field('value', $.expression), 'as', field('type', $.type_)),

    empty_return: $ =>
      seq(
        'return',
        optional_with_placeholder(
          'return_value_optional',
          '!unmatchableStringToEnforcePlaceholder!'
        )
      ),

    return: $ =>
      choice(
        prec.left(
          seq(
            'return',
            field('return_value_optional', alias($.expression, $.return_value))
          )
        ),
        prec(-1, $.empty_return)
      ),

    call_expression: $ =>
      prec(
        PREC.call,
        seq(
          field('function_', $.expression),
          '(',
          field('argument_list', seq(sepBy(',', $.argument), optional(','))),
          ')'
        )
      ),

    argument: $ => seq(repeat($.attribute_item), $.expression),

    array_expression: $ =>
      seq(
        '[',
        repeat($.attribute_item),
        choice(
          seq($.expression, ';', field('length', $.expression)),
          seq(sepBy(',', $.expression), optional(','))
        ),
        ']'
      ),

    parenthesized_expression: $ => seq('(', $.expression, ')'),

    tuple_expression: $ =>
      seq(
        '(',
        repeat($.attribute_item),
        seq($.expression, ','),
        repeat(seq($.expression, ',')),
        optional($.expression),
        ')'
      ),

    unit_expression: $ => seq('(', ')'),

    struct_expression: $ =>
      seq(
        field(
          'name',
          choice(
            $._type_identifier,
            alias(
              $.scoped_type_identifier_in_expression_position,
              $.scoped_type_identifier
            ),
            $.generic_type_with_turbofish
          )
        ),
        field('enclosed_body', $.field_initializer_list_block)
      ),

    field_initializer_list_block: $ =>
      seq(
        '{',
        field(
          'class_member_list',
          seq(sepBy(',', alias($.class_member, $.member)), optional(','))
        ),
        '}'
      ),

    class_member: $ =>
      choice(
        $.shorthand_field_initializer,
        $.field_initializer,
        $.base_field_initializer
      ),

    shorthand_field_initializer: $ =>
      seq(repeat($.attribute_item), $.identifier),

    field_initializer: $ =>
      seq(
        repeat($.attribute_item),
        field('name', $._field_identifier),
        ':',
        field('value', $.expression)
      ),

    base_field_initializer: $ => seq('..', $.expression),

    if_clause: $ =>
      seq(
        'if',
        field('condition', $.expression),
        field('if_consequence', $.enclosed_body)
      ),

    else_if_clause: $ => choice($.else_if_plain_clause, $.else_if_let_clause),

    else_if_plain_clause: $ =>
      prec.dynamic(
        1,
        seq(
          'else',
          'if',
          field('condition', $.expression),
          field('if_consequence', $.enclosed_body)
        )
      ),

    if_let_clause: $ =>
      seq(
        'if',
        field(
          'condition',
          seq(
            'let',
            $.pattern_, // pattern
            '=',
            $.expression // value
          )
        ),
        field('if_consequence', $.enclosed_body)
      ),

    else_if_let_clause: $ =>
      prec.dynamic(
        1,
        seq(
          'else',
          'if',
          field(
            'condition',
            seq(
              'let',
              $.pattern_, // pattern
              '=',
              $.expression // value
            )
          ),
          field('if_consequence', $.enclosed_body)
        )
      ),

    if: $ => choice($.if_expression, $.if_let_expression),

    if_expression: $ =>
      seq(
        $.if_clause,
        optional_with_placeholder(
          'else_if_clause_list',
          repeat($.else_if_clause)
        ),
        optional_with_placeholder('else_clause_optional', $.else_clause)
      ),

    if_let_expression: $ =>
      seq(
        alias($.if_let_clause, $.if_clause),
        optional_with_placeholder(
          'else_if_clause_list',
          repeat($.else_if_clause)
        ),
        optional_with_placeholder('else_clause_optional', $.else_clause)
      ),

    else_clause: $ => seq('else', $.enclosed_body),

    match_expression: $ =>
      seq(
        'match',
        field('value', $.expression),
        field('enclosed_body', $.match_block)
      ),

    match_block: $ =>
      seq('{', optional(seq(repeat($.match_arm), $.last_match_arm)), '}'),

    match_arm: $ =>
      seq(
        repeat($.attribute_item),
        field('pattern', choice($.macro_invocation, $.match_pattern)),
        '=>',
        choice(seq($.expression, ','), prec(1, $._expression_ending_with_block))
      ),

    last_match_arm: $ =>
      seq(
        repeat($.attribute_item),
        field('pattern', $.match_pattern),
        '=>',
        field('value', $.expression),
        optional(',')
      ),

    match_pattern: $ =>
      seq($.pattern_, optional(seq('if', field('condition', $.expression)))),

    while: $ =>
      seq(
        optional_with_placeholder(
          'loop_label_optional',
          seq($.loop_label, ':')
        ),
        field(
          'while_clause',
          choice($.while_expression, $.while_let_expression)
        )
      ),

    while_expression: $ =>
      seq('while', field('condition', $.expression), $.enclosed_body),

    while_let_condition: $ =>
      seq(
        'let',
        field('pattern', $.pattern_),
        '=',
        field('value', $.expression)
      ),

    while_let_expression: $ =>
      seq('while', alias($.while_let_condition, $.condition), $.enclosed_body),

    loop: $ =>
      seq(
        optional_with_placeholder(
          'loop_label_optional',
          seq($.loop_label, ':')
        ),
        'loop',
        $.enclosed_body
      ),

    for: $ =>
      seq(
        optional_with_placeholder(
          'loop_label_optional',
          seq($.loop_label, ':')
        ),
        $.for_each_clause
      ),

    for_each_clause: $ =>
      seq(
        'for',
        field('block_iterator', $.pattern_),
        'in',
        field('block_collection', $.expression),
        $.enclosed_body
      ),

    const_block: $ => seq('const', $.enclosed_body),

    move_modifier: $ => field('modifier', 'move'),

    lambda: $ =>
      prec(
        PREC.closure,
        seq(
          optional_with_placeholder('modifier_list', $.move_modifier),
          field('parameters', $.closure_parameters),
          choice(
            prec.dynamic(
              1,
              seq(
                optional_with_placeholder(
                  'return_type_optional',
                  $.function_type_clause
                ),
                $.enclosed_body
              )
            ),
            field('return_value', $.expression)
          )
        )
      ),

    closure_parameter: $ => choice($.pattern_, $.simple_parameter),

    closure_parameters: $ =>
      seq(
        '|',
        optional_with_placeholder(
          'parameter_list',
          sepBy(',', alias($.closure_parameter, $.parameter))
        ),
        '|'
      ),

    loop_label: $ => seq("'", $.identifier),

    break_expression: $ =>
      prec.left(seq('break', optional($.loop_label), optional($.expression))),

    continue_expression: $ =>
      prec.left(seq('continue', optional($.loop_label))),

    index_expression: $ =>
      prec(PREC.call, seq($.expression, '[', $.expression, ']')),

    await_expression: $ => prec(PREC.field, seq($.expression, '.', 'await')),

    field_expression: $ =>
      prec(
        PREC.field,
        seq(
          field('value', $.expression),
          '.',
          field('field', choice($._field_identifier, $.integer_literal))
        )
      ),

    unsafe_block: $ => seq($.unsafe_modifier, $.enclosed_body),

    async_block: $ => seq('async', optional('move'), $.enclosed_body),

    enclosed_trailing_expression: $ => field('statement', $.expression),

    enclosed_body: $ =>
      seq(
        '{',
        optional_with_placeholder(
          'statement_list',
          seq(repeat($.statement), optional($.enclosed_trailing_expression))
        ),
        '}'
      ),

    // Section - Patterns

    pattern_: $ =>
      choice(
        $.literal_pattern_,
        $.primitive_type_identifiers,
        $.identifier,
        $.scoped_identifier,
        $.tuple_pattern,
        $.tuple_struct_pattern,
        $.struct_pattern,
        $.ref_pattern,
        $.slice_pattern,
        $.captured_pattern,
        $.reference_pattern,
        $.remaining_field_pattern,
        $.mut_pattern,
        $.range_pattern,
        $.or_pattern,
        $.const_block,
        '_'
      ),

    tuple_pattern: $ => seq('(', sepBy(',', $.pattern_), optional(','), ')'),

    slice_pattern: $ => seq('[', sepBy(',', $.pattern_), optional(','), ']'),

    tuple_struct_pattern: $ =>
      seq(
        field('type', choice($.identifier, $.scoped_identifier)),
        '(',
        sepBy(',', $.pattern_),
        optional(','),
        ')'
      ),

    struct_pattern: $ =>
      seq(
        field('type', choice($._type_identifier, $.scoped_type_identifier)),
        '{',
        sepBy(',', choice($.field_pattern, $.remaining_field_pattern)),
        optional(','),
        '}'
      ),

    field_pattern: $ =>
      seq(
        optional('ref'),
        optional_with_placeholder('modifier_list', $.mutable_specifier),
        choice(
          alias($.identifier, $.shorthand_field_identifier),
          seq(
            $._field_identifier, //name
            ':',
            field('pattern', $.pattern_)
          )
        )
      ),

    remaining_field_pattern: $ => '..',

    mut_pattern: $ => prec(-1, seq($.mutable_specifier, $.pattern_)),

    range_pattern: $ =>
      seq(
        choice($.literal_pattern_, $._path),
        choice('...', '..='),
        choice($.literal_pattern_, $._path)
      ),

    ref_pattern: $ => seq('ref', $.pattern_),

    captured_pattern: $ => seq($.identifier, '@', $.pattern_),

    reference_pattern: $ =>
      seq(
        '&',
        optional_with_placeholder('modifier_list', $.mutable_specifier),
        $.pattern_
      ),

    or_pattern: $ => prec.left(-2, seq($.pattern_, '|', $.pattern_)),

    // Section - Literals

    literal_: $ =>
      choice(
        $.string_literal,
        $.raw_string_literal,
        $.char_literal,
        $.boolean_literal,
        $.integer_literal,
        $.float_literal
      ),

    literal_pattern_: $ =>
      choice(
        $.string_literal,
        $.raw_string_literal,
        $.char_literal,
        $.boolean_literal,
        $.integer_literal,
        $.float_literal,
        $.negative_literal
      ),

    negative_literal: $ => seq('-', choice($.integer_literal, $.float_literal)),

    integer_literal: $ =>
      token(
        seq(
          choice(/[0-9][0-9_]*/, /0x[0-9a-fA-F_]+/, /0b[01_]+/, /0o[0-7_]+/),
          optional(choice(...numeric_types))
        )
      ),

    string_start: $ => /b?"/,

    string_literal: $ =>
      seq(
        alias($.string_start, '"'),
        repeat(choice($.escape_sequence, $.string_content)),
        token.immediate('"')
      ),

    char_literal: $ =>
      token(
        seq(
          optional('b'),
          "'",
          optional(
            choice(
              seq(
                '\\',
                choice(
                  /[^xu]/,
                  /u[0-9a-fA-F]{4}/,
                  /u{[0-9a-fA-F]+}/,
                  /x[0-9a-fA-F]{2}/
                )
              ),
              /[^\\']/
            )
          ),
          "'"
        )
      ),

    escape_sequence: $ =>
      token.immediate(
        seq(
          '\\',
          choice(
            /[^xu]/,
            /u[0-9a-fA-F]{4}/,
            /u{[0-9a-fA-F]+}/,
            /x[0-9a-fA-F]{2}/
          )
        )
      ),

    boolean_literal: $ => choice('true', 'false'),

    // Serenade: Not sure what this rule does, because the external matches return the
    // inner matches instead, and the `comment` node never shows up.
    comment: $ => choice($.line_comment, $.block_comment),

    line_comment: $ => token(seq('//', /.*/)),

    _path: $ =>
      choice(
        $.self,
        $.primitive_type_identifiers,
        $.metavariable,
        $.super,
        $.crate,
        $.identifier,
        $.scoped_identifier,
        $._reserved_identifier
      ),

    // Serenade: Add additional level of nesting for internal reasons.
    identifier: $ => $.identifier_,

    identifier_: $ => /(r#)?[_\p{XID_Start}][_\p{XID_Continue}]*/,

    primitive_type_identifiers: $ =>
      field('identifier', choice(...primitive_types)),

    _reserved_identifier: $ => choice('default', 'union'),

    _type_identifier: $ => $.identifier,
    _field_identifier: $ => $.identifier,

    self: $ => 'self',
    super: $ => 'super',
    crate: $ => 'crate',

    metavariable: $ => /\$[a-zA-Z_]\w*/,
  },
})

function sepBy1(sep, rule) {
  return seq(rule, repeat(seq(sep, rule)))
}

function sepBy(sep, rule) {
  return optional(sepBy1(sep, rule))
}

function optional_with_placeholder(field_name, rule) {
  return choice(field(field_name, rule), field(field_name, blank()))
}
