// The portable dashboard serves embedded static files on a loopback port.
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"time"
)

//go:embed all:public
var assets embed.FS

func openBrowser(url string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}

func main() {
	headless := flag.Bool("no-browser", false, "print the address without launching a browser")
	flag.Parse()
	root, err := fs.Sub(assets, "public")
	if err != nil {
		log.Fatal(err)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:38471")
	if err != nil {
		fmt.Println("The usual port is busy. This session will use a temporary port.")
		listener, err = net.Listen("tcp4", "127.0.0.1:0")
	}
	if err != nil {
		log.Fatal(err)
	}
	addr := listener.Addr().String()
	url := "http://" + addr + "/"
	fmt.Println(url)
	fmt.Println("Keep this window open while using the dashboard. Press Ctrl+C to close.")
	if !*headless {
		if err := openBrowser(url); err != nil {
			fmt.Println("Open the address above in your browser.")
		}
	}
	files := http.FileServer(http.FS(root))
	server := http.Server{
		ReadHeaderTimeout: 5 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Host != addr {
				http.Error(w, "Unknown host", http.StatusBadRequest)
				return
			}
			files.ServeHTTP(w, r)
		}),
	}
	log.Fatal(server.Serve(listener))
}
