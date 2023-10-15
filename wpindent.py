import re
from dataclasses import dataclass
import json

"""
wordpress indenter.

std wordpress:
    <!-- tag --> .. <!-- /tag -->

uxbuilder:
    [tag] .. [/tag]

"""
def indent(level): return "  "*level


def stripspaces(txt):
    # shrink whitespace to single space,
    # and strip leading/trailing whitespace.
    txt = re.sub(r'\s+', ' ', txt)
    txt = re.sub(r'^\s+|\s+$', '', txt)
    return txt


def escapevalue(v):
    if not v:
        return v
    return stripspaces(v).replace("&", "&amp;").replace("\"", "&quot;")


class TokenBase:
    """
    baseclass for the nested tokens.
    provides the following methods:
      - addChild
      - oneline and multiline are used by the formatter to find
        the best fitting layout.

    subclasses should implement:
      - formatattrs: returns the tag's attribute string
      - asendtag   : returns the 'end' tag for this tag.
      - asstarttag : format the entire tag including attributes.
      - assingletag: format the entire 'single' tag including attributes.
    """
    def __init__(self):
        self.children = []

    def addChild(self, elem):
        if self.children and isinstance(self.children[-1], BodyToken) and isinstance(elem, BodyToken):
            self.children[-1].merge(elem)
        else:
            self.children.append(elem)

    def astag(self):
        if self.isend:
            return self.asendtag()
        elif self.issingle:
            return self.assingletag()
        else:
            return self.asstarttag()

    def oneline(self):
        """
        output this and all children as one line.
        """
        if self.children:
            ch = "".join(_.oneline() for _ in self.children)
            return f"{self.asstarttag()}{ch}{self.asendtag()}"
        else:
            return f"{self.assingletag()}"

    def multiline(self, level):
        """
        find the best
        """
        if self.children:
            ch_m = "".join(_.multiline(level+1) for _ in self.children)
            ch_o = "".join(_.oneline() for _ in self.children)
            txt_o = f"{self.asstarttag()}{ch_o}{self.asendtag()}"
            if len(txt_o) < 160:
                return indent(level) + txt_o + "\n"
            if len(ch_o) < 160:
                return indent(level) + f"{self.asstarttag()}\n" + \
                       indent(level+1) + ch_o + "\n" + \
                       indent(level) + f"{self.asendtag()}\n"
            else:
                return indent(level) + f"{self.asstarttag()}\n" + \
                       ch_m + \
                       indent(level) + f"{self.asendtag()}\n"
        else:
            return indent(level) + f"{self.assingletag()}\n"


@dataclass
class BodyToken:
    """
    represent anything else.
    """
    body : str

    def merge(self, elem):
        # join two Txt elements with a space
        self.body = self.body + " " + elem.body

    def oneline(self):
        return stripspaces(self.body)

    def multiline(self, level):
        return indent(level) + self.oneline()+"\n"

@dataclass
class WordpressToken(TokenBase):
    """
    represents a wordpress tag.
    """
    isend : bool
    issingle : bool
    tag : str
    params : dict

    def __post_init__(self):
        super().__init__()

    def formatattrs(self):
        if self.params is None:
            return ""
        return " " + json.dumps(self.params)


    def asendtag(self):
        return f"<!-- /{self.tag} -->"

    def asstarttag(self):
        attrtxt = self.formatattrs()
        return f"<!-- {self.tag}{attrtxt} -->"

    def assingletag(self):
        attrtxt = self.formatattrs()
        return f"<!-- {self.tag}{attrtxt} /-->"


@dataclass
class UXBuilderToken(TokenBase):
    """
    represents a ux-builder tag.
    """
    isend : bool
    tag : str
    params : dict
    issingle  : bool = True

    def __post_init__(self):
        super().__init__()
        notsingle = {
            'accordion-item', 'accordion', 'col', 'col_inner', 'featured_box', 'row',
            'row_inner', 'section', 'tab', 'tabgroup', 'ux_html', 'ux_image_box',
            'ux_slider', 'ux_text'
        }

        if self.tag in notsingle:
            self.issingle = False

    def formatattrs(self):
        return "".join(f" {k}=\"{escapevalue(v)}\"" for k, v in self.params.items())

    def asendtag(self):
        return f"[/{self.tag}]"

    def asstarttag(self):
        attrtxt = self.formatattrs()
        return f"[{self.tag}{attrtxt}]"

    def assingletag(self):
        attrtxt = self.formatattrs()
        return f"[{self.tag}{attrtxt} /]"


class Root:
    """
    The root of the parse tree
    """
    def __init__(self):
        self.tag = None
        self.children = []

    def addChild(self, elem):
        self.children.append(elem)

    def printindented(self):
        for e in self.children:
            print(e.multiline(0))


def kv_decoder(text):
    """
    decodes a key=value attribute list into a dictionary.
    """
    attr = []
    paramregex = re.compile(r' (\w+)=\"([^"]*)\"')
    pos = 0
    while True:
        m = paramregex.search(text, pos)
        if not m:
            break
        if pos < m.start():
            print("WARNING: unexpected: '%s'" % text[pos:m.start()])
        attr.append((m[1], m[2]))
        pos = m.end()
    if pos < len(text):
        print("WARNING: unexpected: '%s'" % text[pos:])
    return dict(attr)


def wordpress_tokenizer(text):
    """
    split wordpress text into tokens.
    """
    # 1=/, 2=tag, 3=params, 4=/
    wpregex = re.compile(r'<!-- (/)?(\S+)(?: (\{.*?\}))? (/)?-->')

    # 1=/, 2=tag, 3=params
    uxregex = re.compile(r'\[(/)?(\w+)((?: \w+=\"[^"]*\")*)\]')
    pos = 0
    while True:
        mwp = wpregex.search(text, pos)
        mux = uxregex.search(text, pos)
        if mwp and (not mux or mwp.start() < mux.start()):
            if pos < mwp.start():
                yield BodyToken(text[pos:mwp.start()])
            params = json.loads(mwp[3]) if mwp[3] else None
                
            yield WordpressToken(mwp[1]=='/', mwp[4]=='/', mwp[2], params)
            pos = mwp.end()
        elif mux and (not mwp or mux.start() < mwp.start()):
            if pos < mux.start():
                yield BodyToken(text[pos:mux.start()])
            params = kv_decoder(mux[3])
            yield UXBuilderToken(mux[1]=='/', mux[2], params)
            pos = mux.end()
        else:
            yield BodyToken(text[pos:])

            break


def wpparser(text):
    """
    decodes wordpress text into a tree of tokens.
    """
    stack = [Root()]
    for token in wordpress_tokenizer(text):
        if isinstance(token, BodyToken):
            stack[-1].addChild(token)
        else:
            if token.issingle:
                stack[-1].addChild(token)
            elif token.isend:
                if stack[-1].tag == token.tag:
                    stack.pop()
                else:
                    for i, e in reversed(list(enumerate(stack))):
                        if e.tag==token.tag:
                            print("WARNING: missing end tag for: %s closing %s" % ( stack[i+1:], stack[i:i+1]))
                            while len(stack)>i:
                                stack.pop()
                            break
                    print("WARNING: could not find start tag for: %s in %s" % (token.tag, stack))
            else:
                stack[-1].addChild(token)
                stack.append(token)
    if len(stack)>1:
        print("WARNING: Too many stack items")
        for e in stack[1:]:
            print("**", e)

    return stack[0]


def main():
    import argparse
    parser = argparse.ArgumentParser(description='wordpress indent tool')
    args = parser.parse_args()

    import sys
    text = sys.stdin.read()
    tree = wpparser(text)
    tree.printindented()

if __name__ == '__main__':
    main()

