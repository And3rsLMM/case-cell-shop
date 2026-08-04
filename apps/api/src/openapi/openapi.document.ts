const requestIdHeader = {
  description: "Identificador da requisição recebido ou gerado pela API.",
  schema: {
    type: "string"
  }
} as const;

const productExample = {
  id: "case-clear-iphone-15",
  name: "Capinha Transparente Air para iPhone 15",
  description:
    "Capinha transparente leve com proteção reforçada nas bordas.",
  priceInCents: 2990,
  availableQuantity: 24
} as const;

const orderItemExample = {
  productId: "case-clear-iphone-15",
  name: "Capinha Transparente Air para iPhone 15",
  unitPriceInCents: 2990,
  quantity: 1,
  subtotalInCents: 2990
} as const;

const confirmedOrderExample = {
  id: "order-example-001",
  totalPriceInCents: 2990,
  items: [orderItemExample],
  status: "CONFIRMED",
  createdAt: "2026-08-03T12:00:00.000Z",
  updatedAt: "2026-08-03T12:00:00.120Z"
} as const;

const processingOrderStatusExample = {
  orderId: "order-example-002",
  totalPriceInCents: 2990,
  items: [orderItemExample],
  status: "PROCESSING",
  createdAt: "2026-08-03T12:00:00.000Z",
  updatedAt: "2026-08-03T12:00:00.001Z"
} as const;

const failedOrderStatusExample = {
  ...processingOrderStatusExample,
  orderId: "order-example-003",
  status: "FAILED",
  updatedAt: "2026-08-03T12:00:01.000Z"
} as const;

const validationErrorExample = {
  error: {
    code: "VALIDATION_ERROR",
    message: "Os dados enviados são inválidos.",
    details: {
      fields: [
        {
          field: "items[0].quantity",
          message: "A quantidade deve ser um inteiro maior que zero."
        }
      ]
    },
    retryable: false,
    requestId: "request-example-001"
  }
} as const;

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "CaseCellShop API",
    version: "0.1.0",
    description:
      "API Express do catálogo e checkout da CaseCellShop. Esta especificação é exclusivamente descritiva: express-validator continua sendo a validação HTTP e o Express permanece como fonte única das regras de negócio. Use chaves de idempotência diferentes entre novas intenções de compra."
  },
  servers: [
    {
      url: "/",
      description: "Mesmo host da documentação interativa"
    }
  ],
  tags: [
    {
      name: "Sistema",
      description: "Estado do processo e das dependências da API."
    },
    {
      name: "Produtos",
      description: "Consulta do catálogo ativo e do estoque disponível."
    },
    {
      name: "Pedidos",
      description:
        "Criação idempotente de pedidos e consulta de processamento."
    },
    {
      name: "Cenários ERP",
      description:
        "Cenários determinísticos do ERP simulado. Configure ERP_SIMULATION_MODE no .env e reinicie a API antes de cada cenário. O predev executa um seed destrutivo, portanto cada reinicialização começa sem pedidos e com o estoque original.\n\n- success: POST retorna 201 quando o atraso cabe em ERP_SYNC_TIMEOUT_MS.\n- slow: POST retorna 202; copie orderId para GET /api/orders/{id} até CONFIRMED.\n- temporary-failure: POST retorna 503 na primeira falha; o worker tenta novamente até FAILED e devolve o estoque uma única vez."
    }
  ],
  "x-erp-test-scenarios": [
    {
      id: "erp-success",
      title: "Confirmação síncrona",
      environment: {
        ERP_SIMULATION_MODE: "success",
        ERP_MIN_DELAY_MS: "50",
        ERP_MAX_DELAY_MS: "150",
        ERP_SYNC_TIMEOUT_MS: "200"
      },
      steps: [
        "Reinicie a API.",
        "Execute POST /api/orders com o exemplo ERP — sucesso síncrono.",
        "Confirme HTTP 201 e status CONFIRMED."
      ],
      expected: {
        initialHttpStatus: 201,
        finalOrderStatus: "CONFIRMED",
        stock: "reservado antes do ERP e mantido após a confirmação"
      }
    },
    {
      id: "erp-slow",
      title: "Timeout síncrono e polling",
      environment: {
        ERP_SIMULATION_MODE: "slow",
        ERP_SYNC_TIMEOUT_MS: "200"
      },
      steps: [
        "Reinicie a API.",
        "Execute POST /api/orders com o exemplo ERP — lento e use uma nova Idempotency-Key.",
        "Confirme HTTP 202 e copie orderId.",
        "Execute GET /api/orders/{id} até o estado CONFIRMED."
      ],
      expected: {
        initialHttpStatus: 202,
        intermediateOrderStatus: "PROCESSING",
        finalOrderStatus: "CONFIRMED",
        stock: "reservado enquanto o pedido está em processamento"
      }
    },
    {
      id: "erp-temporary-failure",
      title: "Falha temporária e limite de tentativas",
      environment: {
        ERP_SIMULATION_MODE: "temporary-failure",
        ERP_MAX_ATTEMPTS: "3",
        ERP_MIN_DELAY_MS: "50",
        ERP_MAX_DELAY_MS: "50",
        ERP_SYNC_TIMEOUT_MS: "200"
      },
      steps: [
        "Reinicie a API.",
        "Execute POST /api/orders com o exemplo ERP — falha temporária e use uma nova Idempotency-Key.",
        "Confirme HTTP 503, retryable true e copie details.orderId.",
        "Consulte GET /api/orders/{id}: o worker avança as tentativas até FAILED.",
        "Consulte GET /api/products/{id} e confirme que o estoque foi devolvido."
      ],
      expected: {
        initialHttpStatus: 503,
        intermediateOrderStatus: "PROCESSING",
        finalOrderStatus: "FAILED",
        stock: "devolvido uma única vez após esgotar as tentativas"
      }
    }
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Sistema"],
        summary: "Verifica se o processo da API está ativo",
        operationId: "getHealth",
        responses: {
          "200": {
            description: "Processo ativo.",
            headers: {
              "X-Request-Id": requestIdHeader
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/HealthResponse"
                },
                example: {
                  service: "api",
                  status: "ok",
                  timestamp: "2026-08-03T12:00:00.000Z"
                }
              }
            }
          }
        }
      }
    },
    "/ready": {
      get: {
        tags: ["Sistema"],
        summary: "Verifica se a API e o banco estão prontos",
        operationId: "getReadiness",
        responses: {
          "200": {
            description: "Dependências disponíveis.",
            headers: {
              "X-Request-Id": requestIdHeader
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReadinessResponse"
                },
                example: {
                  service: "api",
                  status: "ready",
                  timestamp: "2026-08-03T12:00:00.000Z"
                }
              }
            }
          },
          "503": {
            $ref: "#/components/responses/ServiceNotReady"
          }
        }
      }
    },
    "/api/products": {
      get: {
        tags: ["Produtos"],
        summary: "Lista produtos ativos",
        description:
          "Retorna produtos em ordem alfabética, com paginação por cursor e estoque disponível.",
        operationId: "listProducts",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Quantidade de itens por página, entre 1 e 100.",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 20
            }
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            description: "Cursor nextCursor retornado pela página anterior.",
            schema: {
              type: "string",
              maxLength: 128
            }
          }
        ],
        responses: {
          "200": {
            description: "Página de produtos ativos.",
            headers: {
              "X-Request-Id": requestIdHeader
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ProductListResponse"
                },
                example: {
                  items: [productExample],
                  nextCursor: null
                }
              }
            }
          },
          "400": {
            $ref: "#/components/responses/ValidationError"
          }
        }
      }
    },
    "/api/products/{id}": {
      get: {
        tags: ["Produtos"],
        summary: "Consulta um produto ativo",
        operationId: "getProductById",
        parameters: [
          {
            $ref: "#/components/parameters/ResourceId"
          }
        ],
        responses: {
          "200": {
            description: "Produto encontrado.",
            headers: {
              "X-Request-Id": requestIdHeader
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Product"
                },
                example: productExample
              }
            }
          },
          "400": {
            $ref: "#/components/responses/ValidationError"
          },
          "404": {
            description: "Produto inexistente ou inativo.",
            headers: {
              "X-Request-Id": requestIdHeader
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ApiError"
                },
                example: {
                  error: {
                    code: "PRODUCT_NOT_FOUND",
                    message: "Produto não encontrado.",
                    details: {},
                    retryable: false,
                    requestId: "request-example-001"
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/orders": {
      post: {
        tags: ["Pedidos", "Cenários ERP"],
        summary: "Cria ou reproduz uma tentativa de compra",
        description:
          "O estoque de todo o carrinho é reservado atomicamente antes da chamada ao ERP. Para testar o ERP de forma determinística, escolha um cenário no topo desta documentação, altere ERP_SIMULATION_MODE no .env e reinicie a API. Reutilize a mesma Idempotency-Key somente para repetir a mesma intenção; use uma chave nova nos demais exemplos.",
        operationId: "createOrder",
        parameters: [
          {
            $ref: "#/components/parameters/IdempotencyKey"
          }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/CreateOrderRequest"
              },
              examples: {
                erpSuccess: {
                  summary: "ERP — sucesso síncrono",
                  description:
                    "Use ERP_SIMULATION_MODE=success e uma Idempotency-Key nova.",
                  value: {
                    items: [
                      {
                        productId: "case-clear-iphone-15",
                        quantity: 1
                      }
                    ]
                  }
                },
                erpSlow: {
                  summary: "ERP — lento, resposta 202 e polling",
                  description:
                    "Use ERP_SIMULATION_MODE=slow e uma Idempotency-Key nova.",
                  value: {
                    items: [
                      {
                        productId: "case-armor-galaxy-s24",
                        quantity: 1
                      }
                    ]
                  }
                },
                erpTemporaryFailure: {
                  summary: "ERP — falha temporária e retries do worker",
                  description:
                    "Use ERP_SIMULATION_MODE=temporary-failure e uma Idempotency-Key nova.",
                  value: {
                    items: [
                      {
                        productId: "case-wallet-redmi-note-13",
                        quantity: 1
                      }
                    ]
                  }
                },
                multiItemCart: {
                  summary: "Carrinho com dois produtos",
                  value: {
                    items: [
                      {
                        productId: "case-clear-iphone-15",
                        quantity: 2
                      },
                      {
                        productId: "case-armor-galaxy-s24",
                        quantity: 1
                      }
                    ]
                  }
                },
                exactLastUnit: {
                  summary: "Última unidade para teste concorrente",
                  description:
                    "O seed deixa este produto com estoque 1. Duas chamadas concorrentes com chaves diferentes resultam em uma compra aceita e um 409.",
                  value: {
                    items: [
                      {
                        productId: "case-silicone-moto-g84",
                        quantity: 1
                      }
                    ]
                  }
                },
                insufficientStock: {
                  summary: "Produto sem estoque",
                  value: {
                    items: [
                      {
                        productId: "case-magsafe-iphone-14",
                        quantity: 1
                      }
                    ]
                  }
                },
                invalidQuantity: {
                  summary: "Quantidade inválida",
                  value: {
                    items: [
                      {
                        productId: "case-clear-iphone-15",
                        quantity: 0
                      }
                    ]
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description:
              "Replay idempotente. O pedido existente é devolvido sem nova reserva nem nova chamada desnecessária ao ERP.",
            headers: {
              "Idempotency-Replayed": {
                description: "Indica que a chave recuperou um pedido existente.",
                schema: {
                  type: "string",
                  enum: ["true"]
                }
              },
              "X-Request-Id": requestIdHeader
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/OrderResponse"
                },
                example: {
                  order: confirmedOrderExample
                }
              }
            }
          },
          "201": {
            description: "ERP confirmou o pedido dentro da janela síncrona.",
            headers: {
              "X-Request-Id": requestIdHeader
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/OrderResponse"
                },
                examples: {
                  erpSuccess: {
                    summary: "ERP confirmou",
                    value: {
                      order: confirmedOrderExample
                    }
                  }
                }
              }
            }
          },
          "202": {
            description:
              "O ERP ultrapassou a janela síncrona. O processamento continua e deve ser acompanhado em statusUrl.",
            headers: {
              "X-Request-Id": requestIdHeader
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/OrderAcceptedResponse"
                },
                examples: {
                  erpSlow: {
                    summary: "ERP lento",
                    value: {
                      orderId: "order-example-002",
                      status: "PROCESSING",
                      statusUrl: "/api/orders/order-example-002"
                    }
                  }
                }
              }
            }
          },
          "400": {
            description: "Body, parâmetro ou Idempotency-Key inválidos.",
            headers: {
              "X-Request-Id": requestIdHeader
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ApiError"
                },
                examples: {
                  validationError: {
                    summary: "Quantidade inválida",
                    value: validationErrorExample
                  },
                  idempotencyKeyRequired: {
                    summary: "Idempotency-Key ausente",
                    value: {
                      error: {
                        code: "IDEMPOTENCY_KEY_REQUIRED",
                        message: "O header Idempotency-Key é obrigatório.",
                        details: {},
                        retryable: false,
                        requestId: "request-example-001"
                      }
                    }
                  }
                }
              }
            }
          },
          "404": {
            description: "Um ou mais produtos não existem ou estão inativos.",
            headers: {
              "X-Request-Id": requestIdHeader
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ApiError"
                },
                example: {
                  error: {
                    code: "PRODUCT_NOT_FOUND",
                    message:
                      "Um ou mais produtos não foram encontrados ou estão inativos.",
                    details: {
                      productIds: ["produto-inexistente"]
                    },
                    retryable: false,
                    requestId: "request-example-001"
                  }
                }
              }
            }
          },
          "409": {
            description: "Estoque insuficiente ou conflito de idempotência.",
            headers: {
              "X-Request-Id": requestIdHeader
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ApiError"
                },
                examples: {
                  insufficientStock: {
                    summary: "Estoque insuficiente",
                    value: {
                      error: {
                        code: "INSUFFICIENT_STOCK",
                        message:
                          "Não há estoque suficiente para um ou mais produtos.",
                        details: {
                          items: [
                            {
                              productId: "case-magsafe-iphone-14",
                              requestedQuantity: 1,
                              availableQuantity: 0
                            }
                          ]
                        },
                        retryable: false,
                        requestId: "request-example-001"
                      }
                    }
                  },
                  idempotencyConflict: {
                    summary: "Mesma chave com outro carrinho",
                    value: {
                      error: {
                        code: "IDEMPOTENCY_CONFLICT",
                        message:
                          "A chave de idempotência já foi usada com outros dados.",
                        details: {},
                        retryable: false,
                        requestId: "request-example-001"
                      }
                    }
                  }
                }
              }
            }
          },
          "502": {
            description:
              "O limite de tentativas do ERP foi atingido durante a janela da requisição.",
            headers: {
              "X-Request-Id": requestIdHeader
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ApiError"
                },
                examples: {
                  erpAttemptsExhausted: {
                    summary: "Falha definitiva do ERP",
                    value: {
                      error: {
                        code: "ERP_PROCESSING_FAILED",
                        message:
                          "O pedido falhou após atingir o limite de tentativas no ERP.",
                        details: {
                          orderId: "order-example-003",
                          statusUrl: "/api/orders/order-example-003"
                        },
                        retryable: false,
                        requestId: "request-example-001"
                      }
                    }
                  }
                }
              }
            }
          },
          "503": {
            description:
              "Falha temporária do ERP. A mesma intenção conserva a Idempotency-Key e pode ser acompanhada pela URL retornada.",
            headers: {
              "X-Request-Id": requestIdHeader
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ApiError"
                },
                examples: {
                  erpTemporaryFailure: {
                    summary: "ERP temporariamente indisponível",
                    value: {
                      error: {
                        code: "ERP_TEMPORARILY_UNAVAILABLE",
                        message: "O ERP está temporariamente indisponível.",
                        details: {
                          orderId: "order-example-003",
                          statusUrl: "/api/orders/order-example-003"
                        },
                        retryable: true,
                        requestId: "request-example-001"
                      }
                    }
                  }
                }
              }
            }
          },
          "500": {
            $ref: "#/components/responses/InternalError"
          }
        }
      }
    },
    "/api/orders/{id}": {
      get: {
        tags: ["Pedidos", "Cenários ERP"],
        summary: "Consulta o estado atual de um pedido",
        description:
          "Endpoint de polling. Pare ao receber CONFIRMED, FAILED ou STOCK_REJECTED. Para o cenário slow, PROCESSING evolui para CONFIRMED; para temporary-failure, evolui para FAILED ao esgotar as tentativas.",
        operationId: "getOrderStatus",
        parameters: [
          {
            $ref: "#/components/parameters/ResourceId"
          }
        ],
        responses: {
          "200": {
            description: "Estado atual do pedido.",
            headers: {
              "X-Request-Id": requestIdHeader
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/OrderStatusResponse"
                },
                examples: {
                  processing: {
                    summary: "ERP ainda em processamento",
                    value: processingOrderStatusExample
                  },
                  confirmed: {
                    summary: "ERP confirmou",
                    value: {
                      ...processingOrderStatusExample,
                      status: "CONFIRMED",
                      updatedAt: "2026-08-03T12:00:00.350Z"
                    }
                  },
                  failed: {
                    summary: "Tentativas esgotadas",
                    value: failedOrderStatusExample
                  }
                }
              }
            }
          },
          "400": {
            $ref: "#/components/responses/ValidationError"
          },
          "404": {
            description: "Pedido não encontrado.",
            headers: {
              "X-Request-Id": requestIdHeader
            },
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ApiError"
                },
                example: {
                  error: {
                    code: "ORDER_NOT_FOUND",
                    message: "Pedido não encontrado.",
                    details: {},
                    retryable: false,
                    requestId: "request-example-001"
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  components: {
    parameters: {
      ResourceId: {
        name: "id",
        in: "path",
        required: true,
        description: "Identificador não vazio com até 128 caracteres.",
        schema: {
          type: "string",
          minLength: 1,
          maxLength: 128
        }
      },
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        description:
          "Chave entre 8 e 128 caracteres. Reutilize-a apenas para o mesmo carrinho; uma nova intenção exige uma nova chave.",
        schema: {
          type: "string",
          minLength: 8,
          maxLength: 128,
          example: "checkout-swagger-001"
        }
      }
    },
    responses: {
      ValidationError: {
        description: "Entrada estruturalmente inválida.",
        headers: {
          "X-Request-Id": requestIdHeader
        },
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ApiError"
            },
            example: validationErrorExample
          }
        }
      },
      ServiceNotReady: {
        description: "Uma dependência da API não está disponível.",
        headers: {
          "X-Request-Id": requestIdHeader
        },
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ApiError"
            },
            example: {
              error: {
                code: "SERVICE_NOT_READY",
                message:
                  "A API ainda não está pronta para receber tráfego.",
                details: {},
                retryable: true,
                requestId: "request-example-001"
              }
            }
          }
        }
      },
      InternalError: {
        description: "Erro interno inesperado, sem exposição de stack trace.",
        headers: {
          "X-Request-Id": requestIdHeader
        },
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ApiError"
            },
            example: {
              error: {
                code: "INTERNAL_ERROR",
                message: "Ocorreu um erro interno inesperado.",
                details: {},
                retryable: true,
                requestId: "request-example-001"
              }
            }
          }
        }
      }
    },
    schemas: {
      HealthResponse: {
        type: "object",
        additionalProperties: false,
        required: ["service", "status", "timestamp"],
        properties: {
          service: {
            type: "string",
            enum: ["api"]
          },
          status: {
            type: "string",
            enum: ["ok"]
          },
          timestamp: {
            type: "string",
            format: "date-time"
          }
        }
      },
      ReadinessResponse: {
        type: "object",
        additionalProperties: false,
        required: ["service", "status", "timestamp"],
        properties: {
          service: {
            type: "string",
            enum: ["api"]
          },
          status: {
            type: "string",
            enum: ["ready"]
          },
          timestamp: {
            type: "string",
            format: "date-time"
          }
        }
      },
      Product: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "name",
          "description",
          "priceInCents",
          "availableQuantity"
        ],
        properties: {
          id: {
            type: "string"
          },
          name: {
            type: "string"
          },
          description: {
            type: "string"
          },
          priceInCents: {
            type: "integer",
            minimum: 0,
            description: "Preço inteiro em centavos."
          },
          availableQuantity: {
            type: "integer",
            minimum: 0,
            description: "Estoque atualmente disponível."
          }
        }
      },
      ProductListResponse: {
        type: "object",
        additionalProperties: false,
        required: ["items", "nextCursor"],
        properties: {
          items: {
            type: "array",
            items: {
              $ref: "#/components/schemas/Product"
            }
          },
          nextCursor: {
            type: "string",
            nullable: true
          }
        }
      },
      CreateOrderItemRequest: {
        type: "object",
        additionalProperties: false,
        required: ["productId", "quantity"],
        properties: {
          productId: {
            type: "string",
            minLength: 1,
            maxLength: 128
          },
          quantity: {
            type: "integer",
            minimum: 1
          }
        }
      },
      CreateOrderRequest: {
        type: "object",
        additionalProperties: false,
        required: ["items"],
        properties: {
          items: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            description:
              "Produtos distintos. O limite padrão é 20 e pode ser configurado no servidor.",
            items: {
              $ref: "#/components/schemas/CreateOrderItemRequest"
            }
          }
        }
      },
      OrderStatus: {
        type: "string",
        enum: [
          "PENDING",
          "PROCESSING",
          "CONFIRMED",
          "FAILED",
          "STOCK_REJECTED"
        ]
      },
      OrderItem: {
        type: "object",
        additionalProperties: false,
        required: [
          "productId",
          "name",
          "unitPriceInCents",
          "quantity",
          "subtotalInCents"
        ],
        properties: {
          productId: {
            type: "string"
          },
          name: {
            type: "string",
            description: "Snapshot do nome no momento da compra."
          },
          unitPriceInCents: {
            type: "integer",
            minimum: 0
          },
          quantity: {
            type: "integer",
            minimum: 1
          },
          subtotalInCents: {
            type: "integer",
            minimum: 0
          }
        }
      },
      Order: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "totalPriceInCents",
          "items",
          "status",
          "createdAt",
          "updatedAt"
        ],
        properties: {
          id: {
            type: "string"
          },
          totalPriceInCents: {
            type: "integer",
            minimum: 0
          },
          items: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OrderItem"
            }
          },
          status: {
            $ref: "#/components/schemas/OrderStatus"
          },
          createdAt: {
            type: "string",
            format: "date-time"
          },
          updatedAt: {
            type: "string",
            format: "date-time"
          }
        }
      },
      OrderResponse: {
        type: "object",
        additionalProperties: false,
        required: ["order"],
        properties: {
          order: {
            $ref: "#/components/schemas/Order"
          }
        }
      },
      OrderAcceptedResponse: {
        type: "object",
        additionalProperties: false,
        required: ["orderId", "status", "statusUrl"],
        properties: {
          orderId: {
            type: "string"
          },
          status: {
            type: "string",
            enum: ["PROCESSING"]
          },
          statusUrl: {
            type: "string",
            example: "/api/orders/order-example-002"
          }
        }
      },
      OrderStatusResponse: {
        type: "object",
        additionalProperties: false,
        required: [
          "orderId",
          "status",
          "totalPriceInCents",
          "items",
          "createdAt",
          "updatedAt"
        ],
        properties: {
          orderId: {
            type: "string"
          },
          status: {
            $ref: "#/components/schemas/OrderStatus"
          },
          totalPriceInCents: {
            type: "integer",
            minimum: 0
          },
          items: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OrderItem"
            }
          },
          createdAt: {
            type: "string",
            format: "date-time"
          },
          updatedAt: {
            type: "string",
            format: "date-time"
          }
        }
      },
      ValidationFieldError: {
        type: "object",
        additionalProperties: false,
        required: ["field", "message"],
        properties: {
          field: {
            type: "string"
          },
          message: {
            type: "string"
          }
        }
      },
      ApiError: {
        type: "object",
        additionalProperties: false,
        required: ["error"],
        properties: {
          error: {
            type: "object",
            additionalProperties: false,
            required: [
              "code",
              "message",
              "retryable",
              "requestId"
            ],
            properties: {
              code: {
                type: "string"
              },
              message: {
                type: "string"
              },
              details: {
                type: "object",
                additionalProperties: true
              },
              retryable: {
                type: "boolean"
              },
              requestId: {
                type: "string"
              }
            }
          }
        }
      }
    }
  }
} as const;
