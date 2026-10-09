package main

import (
	"context"
	"fmt"
	"os"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/nanaaikinson/spool/internal/api"
)

func main() {
	b, e := api.OpenAPI()
	if e != nil {
		panic(e)
	}
	doc, e := openapi3.NewLoader().LoadFromData(b)
	if e != nil {
		panic(e)
	}
	if e = doc.Validate(context.Background()); e != nil {
		panic(e)
	}
	if e = os.MkdirAll("api", 0755); e != nil {
		panic(e)
	}
	b = append(b, '\n')
	if e = os.WriteFile("api/openapi.json", b, 0644); e != nil {
		panic(e)
	}
	fmt.Println("Validated api/openapi.json")
}
